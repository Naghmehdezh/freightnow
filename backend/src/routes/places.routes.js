const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const placesService = require('../services/places.service');
const { rateLimit } = require('../utils/rateLimit');

const router = Router();

// Lets the frontend hide the search box when no Google key is configured.
router.get('/status', authenticate, (req, res) => {
  res.json({ enabled: placesService.isConfigured() });
});

router.get('/autocomplete', authenticate, async (req, res, next) => {
  try {
    const suggestions = await placesService.autocomplete(String(req.query.input || '').slice(0, 200), req.query.sessionToken);
    res.json({ suggestions });
  } catch (err) { next(err); }
});

router.get('/details/:placeId', authenticate, async (req, res, next) => {
  try {
    res.json({ address: await placesService.placeDetails(req.params.placeId, req.query.sessionToken) });
  } catch (err) { next(err); }
});

// ─── Public (no login): address search on the guest "Request a quote" page ──────────
// Each call costs money on IFF's Google account, so visitors are limited per connection.
const limitSearch = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, message: 'Too many address searches — please type the address instead.' });
const limitDetails = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: 'Too many address lookups — please type the address instead.' });

router.get('/public/status', (req, res) => {
  res.json({ enabled: placesService.isConfigured() });
});

router.get('/public/autocomplete', limitSearch, async (req, res, next) => {
  try {
    const suggestions = await placesService.autocomplete(String(req.query.input || '').slice(0, 200), req.query.sessionToken);
    res.json({ suggestions });
  } catch (err) { next(err); }
});

router.get('/public/details/:placeId', limitDetails, async (req, res, next) => {
  try {
    res.json({ address: await placesService.placeDetails(req.params.placeId, req.query.sessionToken) });
  } catch (err) { next(err); }
});

module.exports = router;
