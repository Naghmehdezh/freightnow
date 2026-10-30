const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate, optionalAuth } = require('../middleware/auth');
const rateService = require('../services/rate.service');
const { pickupWindowError } = require('../utils/pickupWindow');

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
  // LTL: one entry per group of identical pieces (weight is per piece, lb; dimensions in inches).
  lineItems: z.array(z.object({
    pieces: z.number().int().positive(),
    length: z.number().positive(),
    width: z.number().positive(),
    height: z.number().positive(),
    weight: z.number().positive(),
    freightClass: z.string().optional(),
  })).max(30).optional(),
  pickupDate: z.string().optional(),
  // Pickup window on the pickup date ("HH:MM"): 08:00–17:00, at least 4 hours.
  pickupReadyTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  pickupCloseTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  currency: z.enum(['CAD', 'USD']).optional(),
  declaredValue: z.number().optional(),
  commodity: z.string().optional(),
  accessorials: z.array(z.string()).optional(),
  // FedEx-only options (ignored by other carriers).
  fedexPackaging: z.enum(['YOUR_PACKAGING', 'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_TUBE', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX', 'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX', 'FEDEX_BOX']).optional(),
  fedexOneRate: z.boolean().optional(),
  // Parcel dangerous goods type (with the 'hazmat' accessorial) — FedEx prices each differently.
  dgType: z.enum(['ACCESSIBLE', 'INACCESSIBLE', 'SMALL_QUANTITY_EXCEPTION', 'BATTERY']).optional(),
  battery: z.object({
    material: z.enum(['LITHIUM_ION', 'LITHIUM_METAL']),
    packing: z.enum(['CONTAINED_IN_EQUIPMENT', 'PACKED_WITH_EQUIPMENT']),
  }).optional(),
  // LTL limited access: the type of site (Estes prices limited access by site type).
  limitedAccessType: z.enum(['school', 'secured', 'farm', 'mini_storage', 'worship', 'seaport', 'fair', 'construction']).optional(),
  // Requested delivery date for the 'date_certain' (FedEx Home Delivery®) accessorial.
  homeDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  // LTL is priced (and its freight class set) from the real dimensions — no default pallet size.
  d => d.shipmentType !== 'ltl' || d.lineItems?.length > 0 || (d.dimensions?.length > 0 && d.dimensions?.width > 0 && d.dimensions?.height > 0),
  { message: 'Length, width and height are required for LTL', path: ['dimensions'] },
).superRefine((d, ctx) => {
  if (!d.pickupReadyTime && !d.pickupCloseTime) return;
  const error = pickupWindowError(d.pickupReadyTime, d.pickupCloseTime);
  if (error) ctx.addIssue({ code: 'custom', path: ['pickupCloseTime'], message: error });
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
      freightClass: data.freightClass
        || rateService.estimateFreightClass({ weight: data.weight, pieces: data.pieces || 1, dimensions: { length: data.dimL, width: data.dimW, height: data.dimH } })
        || '70',
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
