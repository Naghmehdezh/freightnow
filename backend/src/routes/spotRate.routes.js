const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const spotRateService = require('../services/spotRate.service');

const router = Router();

const place = z.object({
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  province: z.string().trim().optional(),
  postalCode: z.string().trim().optional(),
  country: z.string().length(2),
}).refine(p => p.city || p.postalCode, { message: 'Enter a city' });

// One group of identical pieces (e.g. 2 pieces of 20 × 30 × 40 cm).
const packageGroup = z.object({
  pieces: z.number().int().positive(),
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  unit: z.enum(['cm', 'in']),
});

// FTL/PTL: weight (lb) + commodity/notes. Air: pickup or drop-off, total weight (kg) and a
// dimension group per set of pieces. Ocean LCL: same as air; Ocean FCL: commodity/notes only.
const spotRateSchema = z.object({
  shipmentType: z.enum(['ftl', 'air', 'ocean']),
  airService: z.enum(['pickup', 'dropoff']).optional(),
  oceanType: z.string().trim().optional(),
  origin: place,
  destination: place,
  weight: z.number().positive().optional(),
  weightUnit: z.enum(['lb', 'kg']).optional(),
  skids: z.number().int().positive().max(60).optional(), // FTL / PTL
  packages: z.array(packageGroup).max(50).optional(),
  commodity: z.string().optional(),
  specialNotes: z.string().optional(),
}).superRefine((d, ctx) => {
  const need = (cond, path, message) => { if (!cond) ctx.addIssue({ code: 'custom', path: [path], message }); };
  const isLcl = d.shipmentType === 'ocean' && /^LCL/i.test(d.oceanType || '');
  if (d.shipmentType === 'ftl') {
    need(d.weight, 'weight', 'Enter the total weight');
    need(d.skids, 'skids', 'Enter the number of skids');
  }
  if (d.shipmentType === 'air') {
    need(d.airService, 'airService', 'Choose pickup or drop-off');
    if (d.airService === 'pickup') need(d.origin.street && d.origin.postalCode, 'origin', 'Pickup needs the full pickup address and postal code');
  }
  if (d.shipmentType === 'ocean') need(d.oceanType, 'oceanType', 'Choose the ocean service type');
  if (d.shipmentType === 'air' || isLcl) {
    need(d.weight, 'weight', 'Enter the total weight');
    need(d.packages?.length, 'packages', 'Enter the dimensions of the pieces');
  }
});

router.post('/', authenticate, validate(spotRateSchema), async (req, res, next) => {
  try {
    const spotRate = await spotRateService.submitSpotRate(req.user.id, req.validated);
    res.status(201).json({
      spotRate,
      message: 'Your request has been submitted. Our team will respond within 2-4 business hours.',
    });
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const result = await spotRateService.getUserSpotRates(req.user.id, { page, limit });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const spotRate = await spotRateService.getSpotRateById(req.params.id, req.user.id);
    res.json(spotRate);
  } catch (err) { next(err); }
});

// Staff pricing / declining lives in spotRateAdmin.routes.js (/api/admin/spot-rates).

module.exports = router;
