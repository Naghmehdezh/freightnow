const { Router } = require('express');
const { optionalAuth } = require('../middleware/auth');
const { z } = require('zod');
const validate = require('../middleware/validate');
const fedexAddr = require('../services/fedexAddressValidation.service');
const dhlAddr = require('../services/dhlAddressValidation.service');

const router = Router();

const validateAddressSchema = z.object({
  streetLines: z.array(z.string().min(1)).min(1).max(2),
  city: z.string().min(1),
  stateOrProvinceCode: z.string().optional(),
  postalCode: z.string().min(1),
  countryCode: z.string().length(2),
});

// POST /api/address-validation — validate an address via FedEx + DHL in parallel
// Returns the best result: valid trumps fallback, fallback trumps invalid.
router.post('/', optionalAuth, validate(validateAddressSchema), async (req, res, next) => {
  try {
    const [fedexResult, dhlResult] = await Promise.all([
      fedexAddr.validateAddress(req.validated).catch(() => ({ valid: null, fallback: true, source: 'fedex' })),
      dhlAddr.validateAddress(req.validated).catch(() => ({ valid: null, fallback: true, source: 'dhl' })),
    ]);

    // Pick the best result: prefer explicit valid > fallback > explicit invalid
    // This way if FedEx validates it, we trust that even if DHL is unavailable, and vice versa
    const results = [fedexResult, dhlResult];
    const validResult = results.find(r => r.valid === true);
    const fallbackResult = results.find(r => r.valid === null);
    const invalidResult = results.find(r => r.valid === false);

    let best;
    if (validResult) {
      best = validResult;
    } else if (fallbackResult) {
      // Both unavailable or one unavailable + one invalid — use the fallback
      best = fallbackResult;
    } else {
      // Both explicitly invalid — return FedEx result (has better suggestions)
      best = invalidResult || fedexResult;
    }

    // Attach which carriers validated for transparency
    best.validatedBy = results
      .filter(r => r.valid === true)
      .map(r => r.source || 'unknown');

    res.json(best);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
