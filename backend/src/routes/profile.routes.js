const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const profileService = require('../services/profile.service');
const User = require('../models/User');
const activityLogService = require('../services/activityLog.service');

const router = Router();

const updateProfileSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().optional(),
});

const updateCompanySchema = z.object({
  name: z.string().min(1),
  street: z.string().optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().min(2),
  phone: z.string().optional(),
  taxNumber: z.string().optional(),
});

const updateNotificationsSchema = z.object({
  shipmentBooked: z.boolean().optional(),
  outForDelivery: z.boolean().optional(),
  delivered: z.boolean().optional(),
  exceptionsDelays: z.boolean().optional(),
  spotRateResponses: z.boolean().optional(),
  claimsUpdates: z.boolean().optional(),
  promotional: z.boolean().optional(),
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const profile = await profileService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) { next(err); }
});

router.put('/', authenticate, validate(updateProfileSchema), async (req, res, next) => {
  try {
    const profile = await profileService.updateProfile(req.user.id, req.validated);
    res.json(profile);
  } catch (err) { next(err); }
});

router.put('/company', authenticate, validate(updateCompanySchema), async (req, res, next) => {
  try {
    const company = await profileService.updateCompany(req.user.id, req.validated);
    res.json(company);
  } catch (err) { next(err); }
});

router.put('/notifications', authenticate, validate(updateNotificationsSchema), async (req, res, next) => {
  try {
    const prefs = await profileService.updateNotifications(req.user.id, req.validated);
    res.json(prefs);
  } catch (err) { next(err); }
});

router.get('/onboarding-status', authenticate, async (req, res, next) => {
  try {
    const staffRoles = ['iff_staff', 'iff_admin'];
    if (staffRoles.includes(req.user.role)) {
      return res.json({ needsOnboarding: false, needsTerms: false, role: req.user.role });
    }
    const needsOnboarding = !req.user.companyId;
    const user = await User.findById(req.user.id).select('termsAcceptedAt fedexTermsAcceptedAt').lean();
    const needsTerms = !user?.termsAcceptedAt || !user?.fedexTermsAcceptedAt;
    res.json({ needsOnboarding, needsTerms, role: req.user.role });
  } catch (err) { next(err); }
});

// POST /api/profile/accept-terms — record acceptance of IFF + FedEx terms
router.post('/accept-terms', authenticate, async (req, res, next) => {
  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = new Date();

    await User.findByIdAndUpdate(req.user.id, {
      termsAcceptedAt: now,
      termsAcceptedFromIp: ip,
      fedexTermsAcceptedAt: now,
      fedexTermsAcceptedFromIp: ip,
    });

    activityLogService.logActivity(req.user.id, req.user.companyId, 'terms_accepted', {
      ip,
      acceptedAt: now,
    });

    res.json({ accepted: true, acceptedAt: now });
  } catch (err) { next(err); }
});

router.delete('/', authenticate, async (req, res, next) => {
  try {
    await profileService.deleteAccount(req.user.id);
    res.json({ message: 'Account deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
