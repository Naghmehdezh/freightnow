const { Router } = require('express');
const { optionalAuth } = require('../middleware/auth');
const { z } = require('zod');
const validate = require('../middleware/validate');
const fedexAddr = require('../services/fedexAddressValidation.service');

const router = Router();

const validateAddressSchema = z.object({
  streetLines: z.array(z.string().min(1)).min(1).max(2),
  city: z.string().min(1),
  stateOrProvinceCode: z.string().optional(),
  postalCode: z.string().min(1),
  countryCode: z.string().length(2),
});

// POST /api/address-validation — validate an address via FedEx
router.post('/', optionalAuth, validate(validateAddressSchema), async (req, res, next) => {
  try {
    const result = await fedexAddr.validateAddress(req.validated);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
