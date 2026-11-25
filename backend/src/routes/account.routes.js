const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { ROLES } = require('../constants/roles');
const accounts = require('../services/account.service');

// Monthly-terms accounts: credit limits (IFF admin), statements and payments (IFF staff/admin),
// and the customer's own account summary.

// ─── IFF staff / admin ─────────────────────────────────────────────
// Mounted at /admin, so the role check sits on each route (not router.use) and doesn't affect
// other /admin/* routers.
const adminRouter = Router();
const staff = [authenticate, requireRole(ROLES.IFF_STAFF, ROLES.IFF_ADMIN)];
const adminOnly = [authenticate, requireRole(ROLES.IFF_ADMIN)];

adminRouter.get('/accounts', ...staff, async (req, res, next) => {
  try { res.json({ data: await accounts.listAccounts() }); } catch (err) { next(err); }
});

adminRouter.patch('/accounts/:companyId', ...adminOnly, validate(z.object({
  paymentTerms: z.enum(['card', 'monthly']).optional(),
  creditLimit: z.number().min(0).max(10_000_000).optional(),
  statementTermsDays: z.number().int().min(0).max(120).optional(),
})), async (req, res, next) => {
  try { res.json(await accounts.setAccountTerms(req.user.id, req.params.companyId, req.validated)); } catch (err) { next(err); }
});

adminRouter.get('/accounts/:companyId/statements', ...staff, async (req, res, next) => {
  try { res.json({ data: await accounts.statementsForCompany(req.params.companyId) }); } catch (err) { next(err); }
});

// "Create statement now" for one company: everything unpaid up to today.
adminRouter.post('/accounts/:companyId/statements', ...staff, async (req, res, next) => {
  try { res.status(201).json(await accounts.createStatementNow(req.user.id, req.params.companyId)); } catch (err) { next(err); }
});

adminRouter.post('/statements/generate', ...staff, validate(z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  companyId: z.string().optional(),
})), async (req, res, next) => {
  try { res.json(await accounts.generateStatements(req.validated)); } catch (err) { next(err); }
});

adminRouter.post('/statements/:id/payments', ...staff, validate(z.object({
  amount: z.number().positive(),
  method: z.enum(['cheque', 'eft', 'card', 'other']).optional(),
  reference: z.string().trim().max(100).optional(),
})), async (req, res, next) => {
  try { res.json(await accounts.recordPayment(req.user.id, req.params.id, req.validated)); } catch (err) { next(err); }
});

// Sandbox only: pay a reserved booking's QuickBooks invoice (the sandbox "Pay now" link is a
// placeholder page), then confirm it like the job would.
adminRouter.post('/bookings/:id/simulate-link-payment', ...staff, async (req, res, next) => {
  try {
    const Booking = require('../models/Booking');
    const qbInvoices = require('../services/qbInvoices.service');
    const bookings = require('../services/booking.service');
    const booking = await Booking.findById(req.params.id);
    if (!booking?.qbInvoiceId || booking.status !== 'awaiting_payment') return res.status(400).json({ error: { code: 'NOT_AWAITING', message: 'This booking is not awaiting a link payment' } });
    await qbInvoices.simulatePayment(booking.qbInvoiceId);
    res.json(await bookings.confirmLinkPayment(booking._id));
  } catch (err) { next(err); }
});

// ─── Customer ──────────────────────────────────────────────────────
const customerRouter = Router();
customerRouter.use(authenticate);

customerRouter.get('/account', async (req, res, next) => {
  try { res.json(await accounts.accountForCompany(req.user.companyId)); } catch (err) { next(err); }
});

customerRouter.get('/statements/:id', async (req, res, next) => {
  try { res.json(await accounts.statementForCompany(req.user.companyId, req.params.id)); } catch (err) { next(err); }
});

module.exports = { adminRouter, customerRouter };
