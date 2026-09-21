const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const fedexAccountService = require('../services/fedexAccount.service');

const router = Router();

const startSchema = z.object({
  fedexAccountNumber: z.string().regex(/^\d{9}$/, 'FedEx account number must be 9 digits'),
  address: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    province: z.string().optional(),
    postalCode: z.string().min(1),
    country: z.string().min(2),
  }),
  customerName: z.string().optional(),
  eulaAccepted: z.boolean(),
});

const factor2StartSchema = z.object({
  method: z.enum(['pin_email', 'pin_sms', 'pin_call', 'invoice']),
});

const verifyPinSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

const verifyInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['CAD', 'USD']),
});

router.post('/', authenticate, validate(startSchema), async (req, res, next) => {
  try {
    const connection = await fedexAccountService.startConnection(req.user.id, req.validated);
    res.status(201).json({ connection });
  } catch (err) { next(err); }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const connections = await fedexAccountService.listConnections(req.user.id);
    res.json({ connections });
  } catch (err) { next(err); }
});

router.post('/:id/factor2/start', authenticate, validate(factor2StartSchema), async (req, res, next) => {
  try {
    const connection = await fedexAccountService.startFactor2(req.user.id, req.params.id, req.validated.method);
    res.json({ connection });
  } catch (err) { next(err); }
});

router.post('/:id/factor2/verify-pin', authenticate, validate(verifyPinSchema), async (req, res, next) => {
  try {
    const connection = await fedexAccountService.verifyPin(req.user.id, req.params.id, req.validated.code);
    res.json({ connection });
  } catch (err) { next(err); }
});

router.post('/:id/factor2/verify-invoice', authenticate, validate(verifyInvoiceSchema), async (req, res, next) => {
  try {
    const connection = await fedexAccountService.verifyInvoice(req.user.id, req.params.id, req.validated);
    res.json({ connection });
  } catch (err) { next(err); }
});

router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await fedexAccountService.disconnect(req.user.id, req.params.id);
    res.json({ message: 'FedEx account disconnected' });
  } catch (err) { next(err); }
});

module.exports = router;
