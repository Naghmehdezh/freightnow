const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { ROLES } = require('../constants/roles');
const pricingRulesService = require('../services/pricingRules.service');

const router = Router();

const bandSchema = z.object({
  max: z.number().positive(),
  mk: z.number(),
});

const publishSchema = z.object({
  bands: z.array(bandSchema).min(1),
  adjusters: z.object({
    xb: z.number(),
    intl: z.number(),
    low_density: z.number(),
    multi: z.number(),
  }),
  floors: z.object({
    Envelope: z.number(),
    Package: z.number(),
    Skid: z.number(),
    LCL: z.number(),
    min_gp: z.number(),
    round: z.number().positive(),
  }),
  dim_divisor: z.number().positive(),
  usdToCadRate: z.number().positive(),
  note: z.string().optional(),
});

// Admin-only: this is the margin policy for every automated quote. Not opened up to
// iff_staff — the business asked specifically for admin control here.
router.get('/active', authenticate, requireRole(ROLES.IFF_ADMIN), async (req, res, next) => {
  try {
    const ruleSet = await pricingRulesService.getActiveRuleSet();
    res.json({ ruleSet });
  } catch (err) { next(err); }
});

router.post('/', authenticate, requireRole(ROLES.IFF_ADMIN), validate(publishSchema), async (req, res, next) => {
  try {
    const ruleSet = await pricingRulesService.publishRuleSet(req.user.id, req.validated);
    res.status(201).json({ ruleSet });
  } catch (err) { next(err); }
});

module.exports = router;
