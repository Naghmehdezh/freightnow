const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const rateService = require('../services/rate.service');

const router = Router();

const rateRequestSchema = z.object({
  shipmentType: z.enum(['envelope', 'parcel', 'ltl']),
  origin: z.object({
    city: z.string().optional(),
    province: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().min(2),
  }),
  destination: z.object({
    city: z.string().optional(),
    province: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().min(2),
  }),
  weight: z.number().positive(),
  pieces: z.number().int().positive().optional(),
  dimensions: z.object({
    length: z.number().positive().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  }).optional(),
  freightClass: z.string().optional(),
  pickupDate: z.string().optional(),
  currency: z.enum(['CAD', 'USD']).optional(),
  declaredValue: z.number().optional(),
  commodity: z.string().optional(),
  accessorials: z.array(z.string()).optional(),
});

// Legacy FedEx endpoint (matches frontend's existing call format)
const fedexLegacySchema = z.object({
  origPostal: z.string(),
  origCountry: z.string(),
  destPostal: z.string(),
  destCountry: z.string(),
  weight: z.number().positive(),
  freightClass: z.string().optional(),
  pieces: z.number().optional(),
  dimL: z.number().optional(),
  dimW: z.number().optional(),
  dimH: z.number().optional(),
  currency: z.string().optional(),
  pickupDate: z.string().optional(),
});

// Get rates from all carriers
router.post('/all', optionalAuth, validate(rateRequestSchema), async (req, res, next) => {
  try {
    const result = await rateService.getAllRates(req.validated, req.user?.id);
    res.json(result);
  } catch (err) { next(err); }
});

// Legacy FedEx endpoint (compatible with existing frontend)
router.post('/fedex', optionalAuth, validate(fedexLegacySchema), async (req, res, next) => {
  try {
    const data = req.validated;
    const params = {
      shipmentType: 'ltl',
      origin: { postalCode: data.origPostal, country: data.origCountry },
      destination: { postalCode: data.destPostal, country: data.destCountry },
      weight: data.weight,
      pieces: data.pieces || 1,
      dimensions: { length: data.dimL, width: data.dimW, height: data.dimH },
      freightClass: data.freightClass || '70',
      pickupDate: data.pickupDate,
      currency: data.currency || 'CAD',
      accessorials: [],
    };
    const rates = await rateService.getSingleCarrierRate('fedex', params);
    res.json({ rates });
  } catch (err) { next(err); }
});

// Get rate from a specific carrier
router.post('/:carrierId', optionalAuth, validate(rateRequestSchema), async (req, res, next) => {
  try {
    const rates = await rateService.getSingleCarrierRate(req.params.carrierId, req.validated);
    if (!rates) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Carrier not found' } });
    res.json({ rates });
  } catch (err) { next(err); }
});

module.exports = router;
