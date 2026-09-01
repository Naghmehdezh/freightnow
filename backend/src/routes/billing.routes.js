const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const billingService = require('../services/billing.service');

const router = Router();

const paymentMethodSchema = z.object({
  type: z.enum(['visa', 'mastercard', 'amex']),
  last4: z.string().length(4),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int().min(2024),
  isDefault: z.boolean().optional(),
});

// Payment methods (company-scoped)
router.get('/payment-methods', authenticate, async (req, res, next) => {
  try {
    if (!req.user.companyId) return res.json({ paymentMethods: [] });
    const methods = await billingService.getPaymentMethods(req.user.companyId);
    res.json({ paymentMethods: methods });
  } catch (err) { next(err); }
});

router.post('/payment-methods', authenticate, validate(paymentMethodSchema), async (req, res, next) => {
  try {
    if (!req.user.companyId) return res.status(403).json({ error: { code: 'NO_COMPANY', message: 'Company required to manage payment methods' } });
    const method = await billingService.addPaymentMethod(req.user.companyId, req.user.id, req.validated);
    res.status(201).json({ paymentMethod: method });
  } catch (err) { next(err); }
});

router.put('/payment-methods/:id/default', authenticate, async (req, res, next) => {
  try {
    if (!req.user.companyId) return res.status(403).json({ error: { code: 'NO_COMPANY', message: 'Company required to manage payment methods' } });
    const method = await billingService.setDefault(req.params.id, req.user.companyId);
    res.json({ paymentMethod: method });
  } catch (err) { next(err); }
});

router.delete('/payment-methods/:id', authenticate, async (req, res, next) => {
  try {
    if (!req.user.companyId) return res.status(403).json({ error: { code: 'NO_COMPANY', message: 'Company required to manage payment methods' } });
    await billingService.deletePaymentMethod(req.params.id, req.user.companyId);
    res.json({ message: 'Payment method removed' });
  } catch (err) { next(err); }
});

// Invoices (company-scoped)
router.get('/invoices', authenticate, async (req, res, next) => {
  try {
    if (!req.user.companyId) return res.json({ invoices: [], pagination: { page: 1, limit: 10, total: 0 } });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const result = await billingService.getInvoices(req.user.companyId, { page, limit });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/invoices/:id', authenticate, async (req, res, next) => {
  try {
    if (!req.user.companyId) return res.status(403).json({ error: { code: 'NO_COMPANY', message: 'Company required' } });
    const invoice = await billingService.getInvoiceById(req.params.id, req.user.companyId);
    res.json(invoice);
  } catch (err) { next(err); }
});

// Stats (company-scoped)
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    if (!req.user.companyId) return res.json({ spentThisMonth: 0, spentThisYear: 0, outstanding: 0 });
    const stats = await billingService.getBillingStats(req.user.companyId);
    res.json(stats);
  } catch (err) { next(err); }
});

module.exports = router;
