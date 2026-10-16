const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const placesService = require('../services/places.service');

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

module.exports = router;
