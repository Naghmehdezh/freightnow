const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const qbService = require('../services/quickbooks.service');
const qbPayments = require('../services/qbPayments.service');
const PaymentMethod = require('../models/PaymentMethod');
const { z } = require('zod');
const validate = require('../middleware/validate');

const router = Router();

// GET /api/quickbooks/connect — redirect admin to QuickBooks OAuth2 authorization
// In production, add `authenticate` middleware back and check role
router.get('/connect', (req, res) => {
  const url = qbService.getAuthorizationUrl('admin');
  res.redirect(url);
});

// GET /api/quickbooks/callback — OAuth2 callback from Intuit
router.get('/callback', async (req, res, next) => {
  try {
    const { code, realmId, state, error } = req.query;
    if (error) {
      return res.status(400).json({ error: { code: 'QB_AUTH_DENIED', message: error } });
    }
    if (!code || !realmId) {
      return res.status(400).json({ error: { code: 'MISSING_PARAMS', message: 'Missing code or realmId' } });
    }

    const result = await qbService.exchangeCodeForTokens(code, realmId, state);
    // Redirect to frontend admin page with success
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/portal/billing?qb_connected=true`);
  } catch (err) { next(err); }
});

// GET /api/quickbooks/status — check connection status (no auth for dev)
router.get('/status', async (req, res, next) => {
  try {
    const status = await qbService.getConnectionStatus();
    res.json(status);
  } catch (err) { next(err); }
});

// POST /api/quickbooks/tokenize-card — tokenize a card via QB Payments
const tokenizeSchema = z.object({
  number: z.string().min(13).max(19),
  expMonth: z.string().length(2),
  expYear: z.string().length(4),
  cvc: z.string().min(3).max(4),
  name: z.string().min(1),
});

router.post('/tokenize-card', authenticate, validate(tokenizeSchema), async (req, res, next) => {
  try {
    if (!req.user.companyId) {
      return res.status(403).json({ error: { code: 'NO_COMPANY', message: 'Company required to add a payment method' } });
    }

    const { number, expMonth, expYear, cvc, name } = req.validated;

    // Tokenize via QuickBooks Payments
    const qbToken = await qbPayments.tokenizeCard({ number, expMonth, expYear, cvc, name });

    // Save as a payment method
    const last4 = number.slice(-4);
    const type = detectCardType(number);

    // Unset current default if this is first card for the company
    const existingCount = await PaymentMethod.countDocuments({ company: req.user.companyId });
    const isDefault = existingCount === 0;

    const pm = await PaymentMethod.create({
      company: req.user.companyId,
      user: req.user.id,
      type,
      last4,
      expiryMonth: parseInt(expMonth),
      expiryYear: parseInt(expYear),
      isDefault,
      qbCardToken: qbToken,
    });

    res.status(201).json({
      id: pm._id,
      type: pm.type,
      last4: pm.last4,
      expiryMonth: pm.expiryMonth,
      expiryYear: pm.expiryYear,
      isDefault: pm.isDefault,
    });
  } catch (err) { next(err); }
});

function detectCardType(number) {
  if (number.startsWith('4')) return 'visa';
  if (/^5[1-5]/.test(number) || /^2[2-7]/.test(number)) return 'mastercard';
  if (/^3[47]/.test(number)) return 'amex';
  if (/^6(?:011|5)/.test(number)) return 'discover';
  return 'other';
}

module.exports = router;
