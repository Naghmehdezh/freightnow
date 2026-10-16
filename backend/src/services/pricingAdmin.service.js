const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
require('../models/Company'); // registered for populate('user.company')
const { priceQuote } = require('./pricingEngine.service');
const { getActiveRuleSet } = require('./pricingRules.service');
const activityLogService = require('./activityLog.service');
const { percentile, round1 } = require('../utils/stats');
const { NotFoundError, ValidationError } = require('../utils/errors');

const round2 = n => (n == null ? null : Math.round(n * 100) / 100);

// Markup actually achieved on the price the customer sees — after any IFF adjustment. Both
// displayRate and baseRate are in the quote's currency, matching how the engine computes its
// own markupPct, so an unadjusted rate's achieved markup equals the engine's.
function achievedMarkup(rate) {
  if (!rate.baseRate) return null;
  return round1((rate.displayRate / rate.baseRate - 1) * 100);
}

function monthsAgo(months) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d;
}

async function listQuotesForAdmin({ from, to, carrierId, adjustedOnly, search, page = 1, limit = 25 } = {}) {
  const quoteFilter = {};
  if (from || to) {
    quoteFilter.createdAt = {};
    if (from) quoteFilter.createdAt.$gte = new Date(from);
    if (to) quoteFilter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  if (search) {
    const users = await User.find({ email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).select('_id');
    quoteFilter.$or = [
      { quoteNumber: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { user: { $in: users.map(u => u._id) } },
    ];
  }

  const [quotes, total] = await Promise.all([
    Quote.find(quoteFilter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate({ path: 'user', select: 'email firstName lastName company', populate: { path: 'company', select: 'name' } }),
    Quote.countDocuments(quoteFilter),
  ]);

  const quoteIds = quotes.map(q => q._id);
  const rateFilter = { quote: { $in: quoteIds } };
  if (carrierId) rateFilter.carrierId = carrierId;
  if (adjustedOnly) rateFilter.adjustedAt = { $ne: null };

  const [rates, bookings] = await Promise.all([
    QuoteRate.find(rateFilter).sort({ displayRate: 1 }).populate('adjustedBy', 'email firstName lastName'),
    Booking.find({ quote: { $in: quoteIds } }).select('quote quoteRate bookingNumber status sellRate originalSellRate balanceAdjustment paymentStatus'),
  ]);

  const bookingByRate = new Map(bookings.map(b => [String(b.quoteRate), b]));
  const ratesByQuote = new Map();
  for (const r of rates) {
    const key = String(r.quote);
    if (!ratesByQuote.has(key)) ratesByQuote.set(key, []);
    ratesByQuote.get(key).push({
      id: r.id,
      carrierId: r.carrierId,
      carrierName: r.carrierName,
      serviceName: r.serviceName,
      cost: r.baseRate,
      costCad: r.costCad,
      currency: r.currency || 'CAD',
      enginePrice: r.engineRate ?? r.displayRate,
      finalPrice: r.displayRate,
      engineMarkupPct: r.markupPct,
      achievedMarkupPct: achievedMarkup(r),
      grossMargin: round2(r.displayRate - r.baseRate),
      rulesVersion: r.rulesVersion,
      isLiveRate: r.isLiveRate,
      booked: bookingByRate.get(String(r._id))?.bookingNumber || null,
      booking: (() => {
        const b = bookingByRate.get(String(r._id));
        return b ? {
          number: b.bookingNumber,
          status: b.status,
          paymentStatus: b.paymentStatus,
          originalSellRate: b.originalSellRate ?? null,
          balanceAdjustment: b.balanceAdjustment || 0,
        } : null;
      })(),
      adjustment: r.adjustedAt ? {
        reason: r.adjustmentReason,
        note: r.adjustmentNote,
        at: r.adjustedAt,
        by: r.adjustedBy ? (r.adjustedBy.email || '') : null,
      } : null,
    });
  }

  const data = quotes
    .map(q => ({
      id: q.id,
      quoteNumber: q.quoteNumber,
      createdAt: q.createdAt,
      status: q.status === 'active' && q.expiresAt < new Date() ? 'expired' : q.status,
      currency: q.currency,
      shipmentType: q.shipmentType,
      lane: `${q.originCity || q.originPostal} ${q.originCountry} → ${q.destCity || q.destPostal} ${q.destCountry}`,
      weight: q.weight,
      pieces: q.pieces,
      customer: q.user ? {
        email: q.user.email,
        name: [q.user.firstName, q.user.lastName].filter(Boolean).join(' '),
        company: q.user.company?.name || null,
      } : null,
      rates: ratesByQuote.get(String(q._id)) || [],
    }))
    // When filtering by carrier/adjusted, hide quotes with no matching rate.
    .filter(q => (!carrierId && !adjustedOnly) || q.rates.length > 0);

  return { data, pagination: { page, limit, total } };
}

async function adjustQuoteRate(actingUserId, quoteRateId, { newRate, discountPct, reason, note, revert }) {
  const rate = await QuoteRate.findById(quoteRateId);
  if (!rate) throw new NotFoundError('Quote rate');
  const quote = await Quote.findById(rate.quote);
  if (!quote) throw new NotFoundError('Quote');

  const booking = await Booking.findOne({ quoteRate: rate._id });
  if (!booking) {
    // Unbooked options can only be repriced while the customer can still book them.
    if (quote.status === 'booked') {
      throw new ValidationError('The customer booked a different carrier on this quote — this option can no longer be booked.');
    }
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      throw new ValidationError('This quote has expired and was never booked — adjusting it would have no effect.');
    }
  } else if (booking.status === 'cancelled') {
    throw new ValidationError('This booking was cancelled — its price can no longer be changed.');
  }

  const engineRate = rate.engineRate ?? rate.displayRate;
  const previousRate = rate.displayRate;

  let target;
  if (revert) {
    target = engineRate;
  } else {
    target = newRate;
    if (target == null && discountPct != null) target = engineRate * (1 - discountPct / 100);
    if (target == null || !(target > 0)) throw new ValidationError('A new price or discount % is required');
    if (!reason) throw new ValidationError('A reason is required when adjusting a price');
  }
  target = round2(target);
  if (!revert && target < rate.baseRate && reason !== 'correction') {
    throw new ValidationError(`New price ${target} is below carrier cost ${rate.baseRate} — use reason "correction" if this is intentional`);
  }
  if (target === previousRate) throw new ValidationError('The new price is the same as the current price');

  rate.engineRate = engineRate;
  rate.displayRate = target;
  if (revert) {
    rate.adjustedBy = undefined;
    rate.adjustedAt = undefined;
    rate.adjustmentReason = undefined;
    rate.adjustmentNote = undefined;
  } else {
    rate.adjustedBy = actingUserId;
    rate.adjustedAt = new Date();
    rate.adjustmentReason = reason;
    rate.adjustmentNote = note || undefined;
  }
  rate.grossMargin = round2(rate.displayRate - rate.baseRate);
  await rate.save();

  let bookingResult = null;
  if (booking) {
    bookingResult = await repriceBooking(actingUserId, booking, previousRate, target, revert ? 'revert' : reason, note);
  } else {
    // The cheapest option is flagged "best rate" for the customer — keep that accurate.
    const siblings = await QuoteRate.find({ quote: quote._id }).sort({ displayRate: 1 });
    await Promise.all(siblings.map((sib, i) => (sib.isBestRate !== (i === 0)
      ? QuoteRate.updateOne({ _id: sib._id }, { isBestRate: i === 0 }) : null)));
  }

  activityLogService.logActivity(actingUserId, booking?.company || null, revert ? 'quote_price_reverted' : 'quote_price_adjusted', {
    quoteNumber: quote.quoteNumber,
    bookingNumber: booking?.bookingNumber || null,
    quoteRateId: rate.id,
    carrierId: rate.carrierId,
    from: previousRate,
    to: target,
    engineRate,
    reason: revert ? 'revert' : reason,
    note: note || null,
  });

  return { rate, booking: bookingResult };
}

// A booked price change flows through to the booking and its invoice. If the customer already
// paid, the difference is recorded on the booking (credit owed / balance due) for IFF to settle
// — there is no automatic refund or extra charge through QuickBooks.
async function repriceBooking(actingUserId, booking, from, to, reason, note) {
  const delta = round2(to - from);
  if (booking.originalSellRate == null) booking.originalSellRate = booking.sellRate;
  booking.sellRate = to;
  booking.priceAdjustments.push({ from, to, reason, note, by: actingUserId, at: new Date() });
  if (booking.paymentStatus === 'paid') {
    booking.balanceAdjustment = round2((booking.balanceAdjustment || 0) + delta);
  }
  await booking.save();

  // Invoices created before items carried a booking ref are matched by booking number.
  const invoice = await Invoice.findOne({ 'items.booking': booking._id })
    || await Invoice.findOne({ 'items.description': new RegExp(`Booking ${booking.bookingNumber}$`) });
  if (invoice) {
    invoice.items.push({
      booking: booking._id,
      description: `Price adjustment — Booking ${booking.bookingNumber} (${reason})`,
      amount: delta,
    });
    invoice.totalAmount = round2(invoice.totalAmount + delta);
    // For a paid booking, the invoice is settled unless there's extra money still to collect;
    // a credit owed to the customer leaves it paid. Unpaid (monthly-terms) invoices stay open.
    if (booking.paymentStatus === 'paid') {
      invoice.status = booking.balanceAdjustment > 0 ? 'pending' : 'paid';
    }
    await invoice.save();
  }

  return {
    bookingNumber: booking.bookingNumber,
    sellRate: booking.sellRate,
    originalSellRate: booking.originalSellRate,
    balanceAdjustment: booking.balanceAdjustment,
    invoiceNumber: invoice?.invoiceNumber || null,
  };
}

// Port of the reference Pricing Engine's calibration_report() (Pricing Engine/files/
// migration-5-void-customers.sql). Differences, forced by freightnow's data model:
//  - bands group on costCad (the value the engine actually bands on);
//  - "reps" becomes distinct customer companies — freightnow has no sales-rep concept;
//  - it measures the markup customers were actually offered (after IFF adjustments), since
//    the engine's own markup would only echo the current band.
// It only proposes — publishing stays a deliberate admin step in the rules editor.
async function calibrationReport({ months = 12, minN = 30, cap = 10 } = {}) {
  const ruleSet = await getActiveRuleSet();
  const quotes = await Quote.find({ createdAt: { $gte: monthsAgo(months) } })
    .select('_id user').populate({ path: 'user', select: 'company' });
  const companyByQuote = new Map(quotes.map(q => [String(q._id), q.user?.company ? String(q.user.company) : `user:${q.user?._id}`]));

  const rates = await QuoteRate.find({
    quote: { $in: quotes.map(q => q._id) },
    costCad: { $gt: 0 },
    $or: [{ adjustmentReason: null }, { adjustmentReason: { $nin: ['contract', 'oneoff'] } }],
  }).select('quote costCad baseRate displayRate adjustedAt');

  const bookedIds = new Set((await Booking.find({ quoteRate: { $in: rates.map(r => r._id) } }).select('quoteRate'))
    .map(b => String(b.quoteRate)));

  const bands = ruleSet.bands;
  const rows = bands.map((band, i) => {
    const bmin = i === 0 ? 0 : bands[i - 1].max;
    const inBand = rates.filter(r => r.costCad > bmin && (r.costCad <= band.max || i === bands.length - 1));
    const markups = inBand.map(achievedMarkup).filter(v => v != null);
    const n = markups.length;
    const median = round1(percentile(markups, 0.5));
    const p25 = round1(percentile(markups, 0.25));
    const p75 = round1(percentile(markups, 0.75));
    const spread = n ? round1(p75 - p25) : null;
    const customers = new Set(inBand.map(r => companyByQuote.get(String(r.quote)))).size;
    const proposed = n >= minN
      ? band.mk + Math.max(-cap, Math.min(cap, Math.round(median) - band.mk))
      : null;

    let status;
    if (n === 0) status = 'no data';
    else if (n < minN) status = `${n}/${minN} quotes`;
    else if (customers === 1) status = 'single customer — review before applying';
    else if (spread > 60) status = 'ready, but spread is wide';
    else status = 'ready';

    const open = i === bands.length - 1;
    return {
      band: open ? `over $${bmin}` : `$${bmin} – $${band.max}`,
      min: bmin,
      max: band.max,
      currentMk: band.mk,
      quotes: n,
      booked: inBand.filter(r => bookedIds.has(String(r._id))).length,
      adjusted: inBand.filter(r => r.adjustedAt).length,
      median,
      p25,
      p75,
      spread,
      customers,
      proposedMk: proposed,
      status,
    };
  });

  return { rulesVersion: ruleSet.version, months, minN, cap, bands: rows };
}

async function summary({ months = 12 } = {}) {
  const quotes = await Quote.find({ createdAt: { $gte: monthsAgo(months) } }).select('_id');
  const quoteIds = quotes.map(q => q._id);
  const [rates, bookings] = await Promise.all([
    QuoteRate.find({ quote: { $in: quoteIds } }).select('baseRate displayRate adjustedAt'),
    Booking.find({ quote: { $in: quoteIds } }).select('costRate sellRate currency'),
  ]);
  const markups = rates.map(achievedMarkup).filter(v => v != null);
  // Bookings can be in CAD or USD — totals are kept per currency, never added together.
  const byCurrency = {};
  for (const b of bookings) {
    const t = byCurrency[b.currency || 'CAD'] ||= { cost: 0, sell: 0, count: 0 };
    t.cost += b.costRate || 0;
    t.sell += b.sellRate || 0;
    t.count += 1;
  }
  const bookedByCurrency = Object.fromEntries(Object.entries(byCurrency).map(([cur, t]) => [cur, {
    shipments: t.count,
    cost: round2(t.cost),
    sell: round2(t.sell),
    grossMargin: round2(t.sell - t.cost),
    marginPct: t.cost ? round1((t.sell / t.cost - 1) * 100) : null,
  }]));

  return {
    months,
    quotes: quotes.length,
    rateOptions: rates.length,
    shipmentsBooked: bookings.length,
    conversionPct: quotes.length ? round1((bookings.length / quotes.length) * 100) : 0,
    bookedByCurrency,
    avgAchievedMarkupPct: markups.length ? round1(markups.reduce((s, v) => s + v, 0) / markups.length) : null,
    medianAchievedMarkupPct: round1(percentile(markups, 0.5)),
    adjustedRates: rates.filter(r => r.adjustedAt).length,
  };
}

// Runs a draft rule set against a sample shipment — the "see the effect before publishing"
// calculator. priceQuote() is pure, so nothing is written.
function preview(ruleSetDraft, shipment) {
  return priceQuote(shipment, { ...ruleSetDraft, version: 'draft' });
}

module.exports = { listQuotesForAdmin, adjustQuoteRate, calibrationReport, summary, preview };
