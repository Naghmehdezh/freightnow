const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { ROLES } = require('../constants/roles');
const spotRateService = require('../services/spotRate.service');

// IFF staff: review, price and decline spot-rate requests (FTL / air / ocean).
const router = Router();
router.use(authenticate, requireRole(ROLES.IFF_STAFF, ROLES.IFF_ADMIN));

router.get('/', async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const result = await spotRateService.listSpotRates({
      status: status || 'pending',
      search,
      page: parseInt(req.query.page) || 1,
      limit: Math.min(parseInt(req.query.limit) || 20, 100),
    });
    res.json(result);
  } catch (err) { next(err); }
});

const quoteSchema = z.object({
  price: z.number().positive(),
  currency: z.enum(['CAD', 'USD']),
  carrierCost: z.number().positive(),
  carrierName: z.string().trim().max(100).optional(),
  serviceName: z.string().trim().max(100).optional(),
  transitDays: z.number().int().min(0).max(120),
  validDays: z.number().int().min(1).max(60).optional(),
  customerNote: z.string().trim().max(1000).optional(),
  staffNote: z.string().trim().max(1000).optional(),
});

router.post('/:id/quote', validate(quoteSchema), async (req, res, next) => {
  try {
    res.json(await spotRateService.quoteSpotRate(req.user.id, req.params.id, req.validated));
  } catch (err) { next(err); }
});

const declineSchema = z.object({
  customerNote: z.string().trim().max(1000).optional(),
  staffNote: z.string().trim().max(1000).optional(),
});

router.post('/:id/decline', validate(declineSchema), async (req, res, next) => {
  try {
    res.json(await spotRateService.declineSpotRate(req.user.id, req.params.id, req.validated));
  } catch (err) { next(err); }
});

module.exports = router;
