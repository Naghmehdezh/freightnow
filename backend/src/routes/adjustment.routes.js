const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { ROLES } = require('../constants/roles');
const svc = require('../services/adjustment.service');

// Price adjustments after a carrier re-weighs / re-measures a shipment (see adjustment.service.js).

const measured = z.object({
  weight: z.number().positive().optional(),
  pieces: z.number().int().positive().optional(),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  freightClass: z.string().trim().max(10).optional(),
}).optional();

const correction = z.object({
  booking: z.string().trim().min(3), // booking (BK-…), quote (Q-…), IFF tracking (IFF-…) or carrier tracking number
  newCost: z.number().positive(),
  measured,
});

// ─── IFF staff / admin ─────────────────────────────────────────────
const adminRouter = Router();
adminRouter.use(authenticate, requireRole(ROLES.IFF_STAFF, ROLES.IFF_ADMIN));

adminRouter.get('/', async (req, res, next) => {
  try { res.json({ data: await svc.listForStaff({ status: req.query.status || 'open', search: req.query.search }), settings: svc.settings() }); }
  catch (err) { next(err); }
});

adminRouter.post('/preview', validate(correction), async (req, res, next) => {
  try { res.json(await svc.preview(req.validated.booking, req.validated)); } catch (err) { next(err); }
});

adminRouter.post('/', validate(correction.extend({
  reason: z.enum(['weight', 'dimensions', 'freight_class', 'accessorial', 'other']),
  carrierReference: z.string().trim().max(100).optional(),
  evidenceNote: z.string().trim().max(2000).optional(),
  staffNote: z.string().trim().max(2000).optional(),
})), async (req, res, next) => {
  try { res.status(201).json(await svc.createAdjustment(req.user.id, req.validated)); } catch (err) { next(err); }
});

adminRouter.post('/:id/send', validate(z.object({ undercharge: z.enum(['credit', 'refund']).optional() })), async (req, res, next) => {
  try { res.json(await svc.sendAdjustment(req.user.id, req.params.id, req.validated)); } catch (err) { next(err); }
});

const note = z.object({ note: z.string().trim().max(1000).optional() });
adminRouter.post('/:id/waive', validate(note), async (req, res, next) => {
  try { res.json(await svc.waive(req.user.id, req.params.id, req.validated)); } catch (err) { next(err); }
});
adminRouter.post('/:id/cancel', async (req, res, next) => {
  try { res.json(await svc.cancel(req.user.id, req.params.id)); } catch (err) { next(err); }
});
adminRouter.post('/:id/mark-paid', validate(note), async (req, res, next) => {
  try { res.json(await svc.markPaid(req.user.id, req.params.id, req.validated)); } catch (err) { next(err); }
});
adminRouter.post('/:id/resolve', validate(z.object({ decision: z.enum(['uphold', 'waive']), note: z.string().trim().max(1000).optional() })), async (req, res, next) => {
  try { res.json(await svc.resolveDispute(req.user.id, req.params.id, req.validated)); } catch (err) { next(err); }
});

// ─── Customers ─────────────────────────────────────────────────────
const customerRouter = Router();
customerRouter.use(authenticate);

customerRouter.get('/', async (req, res, next) => {
  try { res.json(await svc.listForCompany(req.user.companyId)); } catch (err) { next(err); }
});

customerRouter.post('/:id/pay', validate(z.object({ cardToken: z.string().trim().min(10).max(200).optional() })), async (req, res, next) => {
  try { res.json(await svc.payWithCard(req.user.id, req.user.companyId, req.params.id, req.validated)); } catch (err) { next(err); }
});

customerRouter.post('/:id/dispute', validate(z.object({ reason: z.string().trim().min(10).max(2000) })), async (req, res, next) => {
  try { res.json(await svc.dispute(req.user.id, req.user.companyId, req.params.id, req.validated)); } catch (err) { next(err); }
});

module.exports = { adminRouter, customerRouter };
