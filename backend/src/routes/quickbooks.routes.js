const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { ROLES } = require('../constants/roles');
const qbService = require('../services/quickbooks.service');

// QuickBooks connection (sandbox only — see quickbooks.service.js). Card payments never pass
// through these routes: the browser tokenizes the card directly with Intuit.

const router = Router();
const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';
const adminOnly = [authenticate, requireRole(ROLES.IFF_ADMIN)];

// GET /api/quickbooks/connect-url — IFF admin only: the Intuit sign-in link, with a signed state
// tied to this admin so the callback can't be forged.
router.get('/connect-url', ...adminOnly, (req, res) => {
  res.json({ url: qbService.getAuthorizationUrl(qbService.signState(req.user.id)) });
});

// GET /api/quickbooks/callback — Intuit sends the admin back here after sign-in.
router.get('/callback', async (req, res, next) => {
  try {
    const { code, realmId, state, error } = req.query;
    const back = (params) => res.redirect(`${frontendUrl()}/portal/billing?${new URLSearchParams(params)}`);
    if (error) return back({ qb_error: String(error) });
    const userId = qbService.verifyState(state);
    if (!userId) return back({ qb_error: 'The connection link expired or is invalid. Please try again.' });
    if (!code || !realmId) return back({ qb_error: 'Intuit did not return a company. Please try again.' });

    await qbService.exchangeCodeForTokens(String(code), String(realmId), userId);
    back({ qb_connected: 'true' });
  } catch (err) { next(err); }
});

// GET /api/quickbooks/status — IFF admin only: connection details.
router.get('/status', ...adminOnly, async (req, res, next) => {
  try {
    res.json(await qbService.getConnectionStatus());
  } catch (err) { next(err); }
});

// POST /api/quickbooks/disconnect — IFF admin only.
router.post('/disconnect', ...adminOnly, async (req, res, next) => {
  try {
    res.json(await qbService.disconnect());
  } catch (err) { next(err); }
});

// GET /api/quickbooks/payments-config — any signed-in user: whether card payments are on and
// where the browser turns a card into a one-time token. Nothing secret.
router.get('/payments-config', authenticate, async (req, res, next) => {
  try {
    const status = await qbService.getConnectionStatus();
    res.json({ connected: status.connected, environment: status.environment, cardTokenUrl: qbService.getCardTokenUrl() });
  } catch (err) { next(err); }
});

module.exports = router;
