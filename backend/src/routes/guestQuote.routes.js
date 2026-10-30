const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { ROLES } = require('../constants/roles');
const guestQuoteService = require('../services/guestQuote.service');
const { rateLimit } = require('../utils/rateLimit');

// ─── Public: "Continue as guest" quote request (no account) ────────────────

// Simple abuse protection without a captcha: a hidden "website" field (bots fill it in) and
// at most 5 requests per hour from one IP address.
const limitRequests = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: 'Too many quote requests from this connection. Please try again later or call us at 416 798 4151.',
});

const item = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  dimUnit: z.enum(['cm', 'in']),
  weight: z.number().positive(), // one item
  weightUnit: z.enum(['kg', 'lb']),
  quantity: z.number().int().positive().max(999),
});

const guestQuoteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  company: z.string().trim().max(120).optional(),
  email: z.string().trim().email(),
  phone: z.string().trim().regex(/^[+\d\s().-]{7,20}$/, 'Enter a valid phone number'),
  origin: z.string().trim().min(2).max(200),
  originType: z.enum(['door', 'terminal']),
  destination: z.string().trim().min(2).max(200),
  destinationType: z.enum(['door', 'terminal']),
  mode: z.enum(['air', 'ocean', 'land']),
  volume: z.enum(['lcl', 'fcl', 'ltl', 'ftl']).optional(),
  items: z.array(item).max(30).optional(),
  termsOfSale: z.enum(['unknown', 'exw', 'fob', 'cif', 'cfr', 'dap', 'ddp', 'other']).optional(),
  hazardous: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(40).optional(),
  website: z.string().optional(), // honeypot — must stay empty
}).superRefine((d, ctx) => {
  if (d.mode === 'ocean' && !['lcl', 'fcl'].includes(d.volume)) ctx.addIssue({ code: 'custom', path: ['volume'], message: 'Choose loose container load or full container load' });
  if (d.mode === 'land' && !['ltl', 'ftl'].includes(d.volume)) ctx.addIssue({ code: 'custom', path: ['volume'], message: 'Choose less than truckload or full truckload' });
});

const publicRouter = Router();
publicRouter.post('/', limitRequests, validate(guestQuoteSchema), async (req, res, next) => {
  try {
    // Honeypot filled in: answer as if it worked, store nothing.
    if (req.validated.website) return res.status(201).json({ requestNumber: null });
    const { website, ...data } = req.validated;
    const result = await guestQuoteService.submitGuestQuote(data);
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ─── IFF staff: list and follow up guest requests ───────────────────────

const adminRouter = Router();
adminRouter.use(authenticate, requireRole(ROLES.IFF_STAFF, ROLES.IFF_ADMIN));

adminRouter.get('/', async (req, res, next) => {
  try {
    res.json(await guestQuoteService.listGuestQuotes({
      status: req.query.status || 'new',
      search: req.query.search,
      page: parseInt(req.query.page) || 1,
      limit: Math.min(parseInt(req.query.limit) || 50, 100),
    }));
  } catch (err) { next(err); }
});

const updateSchema = z.object({
  status: z.enum(['new', 'contacted', 'quoted', 'declined', 'closed']).optional(),
  staffNote: z.string().trim().max(2000).optional(),
});
adminRouter.patch('/:id', validate(updateSchema), async (req, res, next) => {
  try {
    res.json(await guestQuoteService.updateGuestQuote(req.user.id, req.params.id, req.validated));
  } catch (err) { next(err); }
});

const priceSchema = z.object({
  price: z.number().positive(),
  currency: z.enum(['CAD', 'USD']),
  carrierCost: z.number().positive(),
  carrierName: z.string().trim().max(100).optional(),
  serviceName: z.string().trim().max(100).optional(),
  transitDays: z.number().int().min(0).max(120).optional(),
  validDays: z.number().int().min(1).max(60).optional(),
  customerNote: z.string().trim().max(1000).optional(),
  staffNote: z.string().trim().max(2000).optional(),
});
adminRouter.post('/:id/quote', validate(priceSchema), async (req, res, next) => {
  try {
    res.json(await guestQuoteService.priceGuestQuote(req.user.id, req.params.id, req.validated));
  } catch (err) { next(err); }
});

const declineSchema = z.object({
  customerNote: z.string().trim().max(1000).optional(),
  staffNote: z.string().trim().max(2000).optional(),
});
adminRouter.post('/:id/decline', validate(declineSchema), async (req, res, next) => {
  try {
    res.json(await guestQuoteService.declineGuestQuote(req.user.id, req.params.id, req.validated));
  } catch (err) { next(err); }
});

module.exports = { publicRouter, adminRouter };
