const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const fedexLocations = require('../services/fedexLocations.service');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const { NotFoundError, ValidationError } = require('../utils/errors');

const router = Router();

// GET /api/fedex/locations?quoteRateId=...
// FedEx locations near the quote's destination that accept Hold at Location for the quoted
// FedEx service (Express vs Ground locations differ).
router.get('/locations', authenticate, async (req, res, next) => {
  try {
    const { quoteRateId } = req.query;
    if (!/^[a-f\d]{24}$/i.test(quoteRateId || '')) throw new ValidationError('quoteRateId is required');
    const rate = await QuoteRate.findById(quoteRateId);
    const quote = rate && await Quote.findOne({ _id: rate.quote, user: req.user.id });
    if (!quote || rate.carrierId !== 'fedex') throw new NotFoundError('Rate');

    const locations = await fedexLocations.searchHoldLocations({
      postalCode: quote.destPostal,
      countryCode: quote.destCountry,
      city: quote.destCity,
      serviceCode: rate.serviceCode,
    });
    res.json({ locations });
  } catch (err) { next(err); }
});

module.exports = router;
