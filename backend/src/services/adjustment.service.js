const mongoose = require('mongoose');
const Adjustment = require('../models/Adjustment');
const Booking = require('../models/Booking');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const Shipment = require('../models/Shipment');
const Company = require('../models/Company');
const Payment = require('../models/Payment');
const Invoice = require('../models/Invoice');
const PricingRuleSet = require('../models/PricingRuleSet');
const { getActiveRuleSet } = require('./pricingRules.service');
const { buildPricingInputs, priceWithAccessorials } = require('./rate.service');
const { generateAdjustmentNumber, generateInvoiceNumber } = require('../utils/trackingGenerator');
const { convert } = require('../utils/currency');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { logActivity } = require('./activityLog.service');
const email = require('./email.service');

// Price corrections after booking (carrier re-weigh / re-measure / re-class / extra service).
//
// The carrier's corrected cost goes through the pricing engine with the SAME rules version as
// the original quote, and the customer owes (new price - original engine price). Marking up the
// whole new cost — not just the difference — keeps a small correction from hitting the engine's
// minimum charges. Policy (IFF, Nov 2026):
//   - |difference| <= threshold (C$10): IFF absorbs it
//   - one admin fee per charged adjustment
//   - 14 days to pay, then the account is put on hold (no new bookings)
//   - undercharges become store credit by default; staff can refund to the card instead

function settings() {
  const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
  return {
    threshold: num(process.env.ADJUSTMENT_THRESHOLD, 10),
    adminFee: num(process.env.ADJUSTMENT_ADMIN_FEE, 0), // amount not decided yet — set in .env
    paymentDays: num(process.env.ADJUSTMENT_PAYMENT_DAYS, 14),
  };
}

const round2 = n => Math.round(n * 100) / 100;

async function ruleSetFor(version) {
  if (version) {
    const rs = await PricingRuleSet.findOne({ version });
    if (rs) return rs;
  }
  return getActiveRuleSet();
}

// The quote's rate-request params, optionally with the carrier's measurements in place of the
// customer's (weight, dimensions, freight class).
function paramsFromQuote(quote, measured) {
  const pieces = measured?.pieces || quote.pieces || 1;
  const params = {
    shipmentType: quote.shipmentType,
    origin: { country: quote.originCountry },
    destination: { country: quote.destCountry },
    weight: quote.weight,
    pieces: quote.pieces || 1,
    dimensions: quote.dimL ? { length: quote.dimL, width: quote.dimW, height: quote.dimH } : undefined,
    lineItems: quote.lineItems?.length ? quote.lineItems.map(i => ({ ...i })) : undefined,
    freightClass: quote.freightClass,
    currency: quote.currency,
  };
  if (!measured) return params;
  const hasDims = measured.length && measured.width && measured.height;
  if (hasDims) {
    // The carrier's measured unit replaces the piece groups.
    const weight = measured.weight || params.weight;
    params.lineItems = params.lineItems ? [{ pieces, length: measured.length, width: measured.width, height: measured.height, weight: weight / pieces, freightClass: measured.freightClass || quote.freightClass }] : undefined;
    params.dimensions = { length: measured.length, width: measured.width, height: measured.height };
    params.pieces = pieces;
    params.weight = weight;
  } else if (measured.weight) {
    // Re-weigh only: scale each group's weight to the carrier's total.
    const factor = measured.weight / (params.weight || measured.weight);
    if (params.lineItems) params.lineItems = params.lineItems.map(i => ({ ...i, weight: i.weight * factor }));
    params.weight = measured.weight;
  }
  if (measured.freightClass) params.freightClass = measured.freightClass;
  return params;
}

// Staff may have any of these numbers from the carrier or the customer: booking (BK-…), quote
// (Q-…), IFF tracking (IFF-…) or the carrier's own tracking / PRO number.
async function findBooking(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  if (mongoose.isValidObjectId(raw)) {
    const byId = await Booking.findById(raw);
    if (byId) return byId;
  }
  const upper = raw.toUpperCase();
  const byNumber = await Booking.findOne({ bookingNumber: upper });
  if (byNumber) return byNumber;
  const quote = await Quote.findOne({ quoteNumber: upper }).select('_id');
  if (quote) {
    const byQuote = await Booking.findOne({ quote: quote._id });
    if (byQuote) return byQuote;
  }
  const shipment = await Shipment.findOne({ $or: [{ trackingNumber: upper }, { carrierTrackingNumber: raw }, { carrierTrackingNumber: upper }, { carrierConfirmationNumber: raw }] }).select('booking');
  if (shipment?.booking) return Booking.findById(shipment.booking);
  return null;
}

async function loadBookingContext(bookingRef) {
  const booking = await findBooking(bookingRef);
  if (!booking) throw new ValidationError(`No booking found for "${String(bookingRef).trim()}". Use a booking (BK-…), quote (Q-…), IFF tracking (IFF-…) or carrier tracking number.`);
  const [quote, rate, shipment] = await Promise.all([
    Quote.findById(booking.quote),
    QuoteRate.findById(booking.quoteRate),
    Shipment.findOne({ booking: booking._id }),
  ]);
  if (!quote || !rate) throw new NotFoundError('Quote for this booking');
  return { booking, quote, rate, shipment };
}

// Works out the numbers for a correction — nothing is saved.
async function calculate(bookingRef, { newCost, measured } = {}) {
  const { booking, quote, rate, shipment } = await loadBookingContext(bookingRef);
  if (!(Number(newCost) > 0)) throw new ValidationError('Enter the carrier\'s corrected cost');
  const { threshold, adminFee } = settings();
  const currency = rate.currency === 'USD' ? 'USD' : 'CAD';
  const ruleSet = await ruleSetFor(rate.rulesVersion);
  const accessorialCharges = rate.accessorialCharges || [];

  const originalCost = booking.costRate ?? rate.baseRate;
  const original = priceWithAccessorials({ rate: originalCost, accessorialCharges }, currency, buildPricingInputs(paramsFromQuote(quote), ruleSet));
  const corrected = priceWithAccessorials({ rate: Number(newCost), accessorialCharges }, currency, buildPricingInputs(paramsFromQuote(quote, measured), ruleSet));

  // The customer is charged/credited in the currency they paid the booking in (at its locked rate).
  const payCurrency = booking.chargeCurrency || currency;
  const fx = booking.fxRate || rate.fxRate || ruleSet.usdToCadRate || 1.4;
  const toPay = n => convert(n, currency, payCurrency, fx);
  original.sell = toPay(original.sell);
  corrected.sell = toPay(corrected.sell);
  const difference = round2(corrected.sell - original.sell);
  let outcome = 'absorbed';
  if (difference > threshold) outcome = 'charge';
  else if (difference < -threshold) outcome = 'credit';

  return {
    booking, quote, rate, shipment, currency: payCurrency, carrierCurrency: currency,
    entered: { weight: quote.weight, pieces: quote.pieces, length: quote.dimL, width: quote.dimW, height: quote.dimH, freightClass: quote.freightClass },
    originalCost,
    newCost: round2(Number(newCost)),
    originalPrice: original.sell,
    newPrice: corrected.sell,
    paidPrice: booking.chargeAmount ?? booking.sellRate,
    difference,
    adminFee: outcome === 'charge' ? adminFee : 0,
    amountDue: outcome === 'charge' ? round2(difference + adminFee) : 0,
    creditAmount: outcome === 'credit' ? round2(-difference) : 0,
    outcome,
    rulesVersion: ruleSet.version,
    threshold,
  };
}

function summary(adj) {
  const a = adj.toObject ? adj.toObject() : adj;
  return { ...a, id: String(a._id), _id: undefined };
}

async function preview(bookingRef, input) {
  const c = await calculate(bookingRef, input);
  return {
    bookingNumber: c.booking.bookingNumber,
    carrierName: c.booking.carrierName,
    trackingNumber: c.shipment?.carrierTrackingNumber || c.shipment?.trackingNumber,
    currency: c.currency,
    entered: c.entered,
    originalCost: c.originalCost, newCost: c.newCost,
    originalPrice: c.originalPrice, newPrice: c.newPrice, paidPrice: c.paidPrice,
    difference: c.difference, adminFee: c.adminFee, amountDue: c.amountDue, creditAmount: c.creditAmount,
    outcome: c.outcome, rulesVersion: c.rulesVersion, threshold: c.threshold,
  };
}

async function createAdjustment(staffUserId, { booking: bookingRef, newCost, measured, reason, carrierReference, evidenceNote, staffNote }) {
  const c = await calculate(bookingRef, { newCost, measured });
  const open = await Adjustment.findOne({ booking: c.booking._id, status: { $in: ['draft', 'sent', 'disputed'] } });
  if (open) throw new ValidationError(`Booking ${c.booking.bookingNumber} already has an open adjustment (${open.adjustmentNumber})`);
  const adj = await Adjustment.create({
    adjustmentNumber: await generateAdjustmentNumber(),
    booking: c.booking._id,
    shipment: c.shipment?._id,
    company: c.booking.company,
    user: c.booking.user,
    currency: c.currency,
    reason,
    entered: c.entered,
    measured,
    carrierReference,
    evidenceNote,
    staffNote,
    originalCost: c.originalCost,
    newCost: c.newCost,
    originalPrice: c.originalPrice,
    newPrice: c.newPrice,
    difference: c.difference,
    adminFee: c.adminFee,
    amountDue: c.amountDue,
    creditAmount: c.creditAmount,
    rulesVersion: c.rulesVersion,
    outcome: c.outcome,
    createdBy: staffUserId,
  });
  logActivity(staffUserId, c.booking.company, 'adjustment_created', { adjustmentNumber: adj.adjustmentNumber, bookingNumber: c.booking.bookingNumber, difference: c.difference, outcome: c.outcome });
  return summary(adj);
}

async function findAdjustment(id) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Adjustment');
  const adj = await Adjustment.findById(id);
  if (!adj) throw new NotFoundError('Adjustment');
  return adj;
}

async function customerOf(adj) {
  const [booking, company] = await Promise.all([
    Booking.findById(adj.booking).populate('user', 'email firstName lastName'),
    Company.findById(adj.company),
  ]);
  return { booking, company, customer: booking?.user };
}

// Send to the customer and carry out the outcome. For an undercharge, staff choose store credit
// (default) or a refund to the card the booking was paid with.
async function sendAdjustment(staffUserId, id, { undercharge = 'credit' } = {}) {
  const adj = await findAdjustment(id);
  if (adj.status !== 'draft') throw new ValidationError(`This adjustment is already ${adj.status}`);
  const { booking, company, customer } = await customerOf(adj);
  const now = new Date();
  adj.sentAt = now;
  adj.handledBy = staffUserId;

  if (adj.outcome === 'charge') {
    adj.status = 'sent';
    adj.dueDate = new Date(now.getTime() + settings().paymentDays * 86400000);
    // Monthly-terms customers: the balance goes on an invoice they pay with their statement.
    if (company?.paymentTerms === 'monthly') {
      await Invoice.create({
        invoiceNumber: await generateInvoiceNumber(),
        company: adj.company,
        user: adj.user,
        totalAmount: adj.amountDue,
        currency: adj.currency,
        status: 'pending',
        items: [{ booking: adj.booking, shipment: adj.shipment, description: `Price adjustment ${adj.adjustmentNumber} (booking ${booking?.bookingNumber})`, amount: adj.amountDue }],
      });
    }
    email.sendAdjustmentNotice(adj, booking, customer, company);
  } else if (adj.outcome === 'credit') {
    if (undercharge === 'refund') {
      const payment = await Payment.findOne({ booking: adj.booking, status: 'succeeded', qbTransactionId: { $not: /^(sandbox-|store-credit)/ } }).sort({ createdAt: -1 });
      if (!payment?.qbTransactionId) throw new ValidationError('This booking has no card payment to refund — use store credit instead');
      const { refundCharge } = require('./qbPayments.service');
      const refund = await refundCharge(payment.qbTransactionId, adj.creditAmount);
      await Payment.create({ booking: adj.booking, user: adj.user, amount: -adj.creditAmount, currency: adj.currency, qbTransactionId: refund.id, status: 'refunded', method: 'card' });
      adj.outcome = 'refund';
      adj.status = 'refunded';
      adj.qbTransactionId = refund.id;
    } else {
      await Company.updateOne({ _id: adj.company }, { $inc: { [`credit.${adj.currency}`]: adj.creditAmount } });
      adj.status = 'credited';
    }
    email.sendAdjustmentCredit(adj, booking, customer);
  } else {
    adj.status = 'absorbed'; // within the threshold: nothing to collect or return
  }
  await adj.save();
  logActivity(staffUserId, adj.company, 'adjustment_sent', { adjustmentNumber: adj.adjustmentNumber, status: adj.status, amountDue: adj.amountDue, creditAmount: adj.creditAmount });
  return summary(adj);
}

// Overdue balances put the account on hold — an unpaid price adjustment past its due date, or a
// monthly statement past its due date. Paying or settling them lifts it.
async function refreshHold(companyId) {
  if (!companyId) return { active: false };
  const Statement = require('../models/Statement');
  const now = new Date();
  const [overdueAdjustments, overdueStatements] = await Promise.all([
    Adjustment.countDocuments({ company: companyId, status: 'sent', dueDate: { $lt: now } }),
    Statement.countDocuments({ company: companyId, status: { $in: ['open', 'partially_paid'] }, dueDate: { $lt: now } }),
  ]);
  const company = await Company.findById(companyId);
  if (!company) return { active: false };
  const reasons = [
    overdueStatements && `${overdueStatements} statement(s) overdue`,
    overdueAdjustments && `${overdueAdjustments} price adjustment(s) overdue`,
  ].filter(Boolean);
  const active = reasons.length > 0;
  const reason = reasons.join('; ');
  if (active !== !!company.accountHold?.active || (active && reason !== company.accountHold?.reason)) {
    company.accountHold = active ? { active: true, reason, since: company.accountHold?.since || now } : { active: false };
    await company.save();
    logActivity(null, companyId, active ? 'account_hold_on' : 'account_hold_off', { overdueAdjustments, overdueStatements });
  }
  return company.accountHold || { active: false };
}

async function settle(adj, fields, actorId, action) {
  Object.assign(adj, fields);
  await adj.save();
  await refreshHold(adj.company);
  logActivity(actorId, adj.company, action, { adjustmentNumber: adj.adjustmentNumber, status: adj.status });
  return summary(adj);
}

async function waive(staffUserId, id, { note } = {}) {
  const adj = await findAdjustment(id);
  if (!['draft', 'sent', 'disputed'].includes(adj.status)) throw new ValidationError(`This adjustment is already ${adj.status}`);
  return settle(adj, { status: 'waived', resolutionNote: note, handledBy: staffUserId }, staffUserId, 'adjustment_waived');
}

async function cancel(staffUserId, id) {
  const adj = await findAdjustment(id);
  if (adj.status !== 'draft') throw new ValidationError('Only a draft adjustment can be cancelled');
  return settle(adj, { status: 'cancelled', handledBy: staffUserId }, staffUserId, 'adjustment_cancelled');
}

// Paid outside the portal (cheque/transfer — e.g. monthly customers).
async function markPaid(staffUserId, id, { note } = {}) {
  const adj = await findAdjustment(id);
  if (!['sent', 'disputed'].includes(adj.status)) throw new ValidationError('Only a sent adjustment can be marked paid');
  await Payment.create({ booking: adj.booking, user: adj.user, amount: adj.amountDue, currency: adj.currency, status: 'succeeded', method: 'offline', qbTransactionId: null });
  return settle(adj, { status: 'paid', paidAt: new Date(), resolutionNote: note, handledBy: staffUserId }, staffUserId, 'adjustment_paid_offline');
}

// Dispute outcome: uphold (customer owes it — 14 new days to pay) or waive.
async function resolveDispute(staffUserId, id, { decision, note }) {
  const adj = await findAdjustment(id);
  if (adj.status !== 'disputed') throw new ValidationError('This adjustment is not disputed');
  if (decision === 'waive') return settle(adj, { status: 'waived', resolutionNote: note, handledBy: staffUserId }, staffUserId, 'adjustment_dispute_waived');
  const dueDate = new Date(Date.now() + settings().paymentDays * 86400000);
  const result = await settle(adj, { status: 'sent', dueDate, resolutionNote: note, handledBy: staffUserId }, staffUserId, 'adjustment_dispute_upheld');
  const { booking, customer, company } = await customerOf(adj);
  email.sendAdjustmentNotice(adj, booking, customer, company);
  return result;
}

// ─── Customer actions ──────────────────────────────────────────────

async function findForCompany(companyId, id) {
  const adj = await findAdjustment(id);
  if (!companyId || String(adj.company) !== String(companyId)) throw new NotFoundError('Adjustment');
  return adj;
}

// Pay a balance by card: same one-time QuickBooks token flow as booking. Store credit in the
// same currency is used first.
async function payWithCard(userId, companyId, id, { cardToken }) {
  const adj = await findForCompany(companyId, id);
  if (!['sent', 'disputed'].includes(adj.status)) throw new ValidationError(`This adjustment is ${adj.status}`);
  const { chargeToken } = require('./qbPayments.service');
  const { getConnectionStatus, ENVIRONMENT } = require('./quickbooks.service');
  const crypto = require('crypto');

  const credit = await takeCredit(companyId, adj.currency, adj.amountDue);
  const toCharge = round2(adj.amountDue - credit);
  let qbTransactionId = credit > 0 ? 'store-credit' : null;
  if (credit > 0) await Payment.create({ booking: adj.booking, user: userId, amount: credit, currency: adj.currency, status: 'succeeded', method: 'credit', qbTransactionId: 'store-credit' });
  if (toCharge > 0) {
    if (!cardToken) {
      await returnCredit(companyId, adj.currency, credit);
      throw new ValidationError('Enter your card details to pay this balance.');
    }
    const qb = await getConnectionStatus();
    try {
      if (qb.connected) {
        const fxRate = (await Booking.findById(adj.booking).select('fxRate').lean())?.fxRate;
        const res = await chargeToken({ token: cardToken, amount: toCharge, currency: adj.currency, usdToCad: fxRate, requestId: crypto.randomUUID().replace(/-/g, '') });
        qbTransactionId = res.id;
      } else if (ENVIRONMENT === 'sandbox') {
        qbTransactionId = `sandbox-not-charged-${adj.adjustmentNumber}`;
      } else {
        throw new Error('Card payments are temporarily unavailable');
      }
    } catch (err) {
      await returnCredit(companyId, adj.currency, credit);
      throw new ValidationError(`Payment failed: ${err.message}`);
    }
    await Payment.create({ booking: adj.booking, user: userId, amount: toCharge, currency: adj.currency, status: 'succeeded', method: 'card', qbTransactionId });
  }
  const result = await settle(adj, { status: 'paid', paidAt: new Date(), paidWithCredit: credit, qbTransactionId }, userId, 'adjustment_paid');
  email.sendAdjustmentReceipt(adj);
  return result;
}

async function dispute(userId, companyId, id, { reason }) {
  const adj = await findForCompany(companyId, id);
  if (adj.status !== 'sent') throw new ValidationError(`This adjustment is ${adj.status}`);
  // A dispute pauses the payment clock (it's no longer "sent", so it can't make the account overdue).
  const result = await settle(adj, { status: 'disputed', disputeReason: reason, disputedAt: new Date() }, userId, 'adjustment_disputed');
  email.sendAdjustmentDisputeNotice(adj);
  return result;
}

// ─── Store credit ──────────────────────────────────────────────────

// Takes up to `max` of the company's credit in that currency (atomically); returns the amount used.
async function takeCredit(companyId, currency, max) {
  if (!companyId || !(max > 0)) return 0;
  const company = await Company.findById(companyId).select('credit');
  const available = round2(company?.credit?.[currency] || 0);
  const use = round2(Math.min(available, max));
  if (use <= 0) return 0;
  const res = await Company.updateOne({ _id: companyId, [`credit.${currency}`]: { $gte: use } }, { $inc: { [`credit.${currency}`]: -use } });
  return res.modifiedCount ? use : 0;
}

async function returnCredit(companyId, currency, amount) {
  if (amount > 0) await Company.updateOne({ _id: companyId }, { $inc: { [`credit.${currency}`]: amount } });
}

// ─── Lists ─────────────────────────────────────────────────────────

async function listForStaff({ status, search } = {}) {
  const where = {};
  if (status === 'open') where.status = { $in: ['draft', 'sent', 'disputed'] };
  else if (status && status !== 'all') where.status = status;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const bookings = await Booking.find({ bookingNumber: rx }).select('_id');
    const quotes = await Quote.find({ quoteNumber: rx }).select('_id');
    if (quotes.length) bookings.push(...await Booking.find({ quote: { $in: quotes.map(q => q._id) } }).select('_id'));
    where.$or = [{ adjustmentNumber: rx }, { booking: { $in: bookings.map(b => b._id) } }];
  }
  const rows = await Adjustment.find(where).sort({ createdAt: -1 }).limit(200)
    .populate('booking', 'bookingNumber carrierName serviceName')
    .populate('company', 'name paymentTerms')
    .lean();
  const now = new Date();
  return rows.map(r => ({ ...summary(r), overdue: r.status === 'sent' && r.dueDate && new Date(r.dueDate) < now }));
}

async function listForCompany(companyId) {
  if (!companyId) return { adjustments: [], credit: { CAD: 0, USD: 0 }, accountHold: { active: false } };
  const hold = await refreshHold(companyId);
  const [rows, company] = await Promise.all([
    Adjustment.find({ company: companyId, status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(100)
      .populate('booking', 'bookingNumber carrierName serviceName').lean(),
    Company.findById(companyId).select('credit').lean(),
  ]);
  const now = new Date();
  return {
    adjustments: rows.map(r => ({
      ...summary(r),
      staffNote: undefined, createdBy: undefined, handledBy: undefined, originalCost: undefined, newCost: undefined,
      overdue: r.status === 'sent' && r.dueDate && new Date(r.dueDate) < now,
    })),
    credit: { CAD: company?.credit?.CAD || 0, USD: company?.credit?.USD || 0 },
    accountHold: hold,
  };
}

module.exports = {
  settings, preview, createAdjustment, sendAdjustment, waive, cancel, markPaid, resolveDispute,
  payWithCard, dispute, refreshHold, takeCredit, returnCredit, listForStaff, listForCompany,
};
