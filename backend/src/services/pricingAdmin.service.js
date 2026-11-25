const Quote = require('../models/Quote');
const { labelFor } = require('../carriers/accessorials');
const QuoteRate = require('../models/QuoteRate');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Adjustment = require('../models/Adjustment');
const Statement = require('../models/Statement');
const Company = require('../models/Company');
const { convert } = require('../utils/currency');
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

// What a booking really made once carrier corrections are settled: the corrected carrier cost,
// plus anything collected from the customer, less anything credited or refunded back.
// A correction still awaiting payment isn't counted as collected (shown as pending instead).
function settledBooking(booking, correction) {
  const cost = correction ? correction.newCost : booking.costRate;
  // Corrections are charged in the customer's currency; margins are in the carrier's currency.
  const toCarrier = n => convert(n || 0, correction?.currency || booking.currency, booking.currency || 'CAD', booking.fxRate);
  const collected = correction?.status === 'paid' ? toCarrier(correction.amountDue) : 0;
  const returned = ['credited', 'refunded'].includes(correction?.status) ? toCarrier(correction.creditAmount) : 0;
  const revenue = round2((booking.sellRate || 0) + collected - returned);
  return {
    cost: round2(cost || 0),
    revenue,
    margin: round2(revenue - (cost || 0)),
    pending: ['sent', 'disputed'].includes(correction?.status) ? toCarrier(correction.amountDue) : 0,
  };
}

// How a booking was paid; bookings made before the method was recorded are inferred.
const paymentMethodOf = b => b.paymentMethod || (b.paymentStatus === 'invoiced' ? 'account' : b.paymentStatus === 'paid' ? 'card' : 'unknown');

// The latest live carrier correction per booking (cancelled drafts ignored).
async function correctionsFor(bookingIds) {
  const rows = await Adjustment.find({ booking: { $in: bookingIds }, status: { $ne: 'cancelled' } }).sort({ createdAt: 1 }).lean();
  return new Map(rows.map(a => [String(a.booking), a]));
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
    Booking.find({ quote: { $in: quoteIds } }).select('quote quoteRate bookingNumber status sellRate costRate currency chargeCurrency chargeAmount fxRate originalSellRate balanceAdjustment paymentStatus paymentMethod payBy'),
  ]);
  const corrections = await correctionsFor(bookings.map(b => b._id));

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
      // The carrier's charge for each selected option (included in cost; passed through at cost).
      accessorialCharges: (r.accessorialCharges || []).map(c => ({ label: c.label, code: c.code, amount: c.amount })),
      notIncluded: r.notIncludedOptions?.length ? { labels: r.notIncludedOptions.map(o => labelFor(o)), message: r.notIncludedMessage } : null,
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
        if (!b) return null;
        const c = corrections.get(String(b._id));
        const settled = settledBooking(b, c);
        return {
          number: b.bookingNumber,
          status: b.status,
          paymentStatus: b.paymentStatus,
          paymentMethod: paymentMethodOf(b),
          // What the customer paid, in the currency they chose (may differ from the carrier's).
          charged: b.chargeAmount != null ? { amount: b.chargeAmount, currency: b.chargeCurrency } : null,
          payBy: b.payBy || null,
          originalSellRate: b.originalSellRate ?? null,
          balanceAdjustment: b.balanceAdjustment || 0,
          // Carrier correction (re-weigh / re-measure) and the margin once it's settled.
          correction: c ? {
            number: c.adjustmentNumber, status: c.status, outcome: c.outcome, reason: c.reason,
            newCost: c.newCost, newPrice: c.newPrice, difference: c.difference,
            amountDue: c.amountDue, creditAmount: c.creditAmount,
          } : null,
          marginAfterCorrections: c ? settled.margin : null,
          pendingCollection: settled.pending || 0,
        };
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
    carrierId: { $ne: 'iff' }, // spot rates are priced by hand, not by the engine bands
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
    Booking.find({ quote: { $in: quoteIds }, status: { $ne: 'cancelled' } }).select('costRate sellRate currency fxRate paymentMethod paymentStatus status'),
  ]);
  const corrections = await correctionsFor(bookings.map(b => b._id));
  const markups = rates.map(achievedMarkup).filter(v => v != null);
  // Bookings can be in CAD or USD — totals are kept per currency, never added together.
  const byCurrency = {};
  const correctionTotals = {};
  const paymentMethods = {};
  for (const b of bookings) {
    const cur = b.currency || 'CAD';
    const t = byCurrency[cur] ||= { cost: 0, sell: 0, count: 0, costAfter: 0, revenueAfter: 0 };
    const c = corrections.get(String(b._id));
    const settled = settledBooking(b, c);
    t.cost += b.costRate || 0;
    t.sell += b.sellRate || 0;
    t.costAfter += settled.cost;
    t.revenueAfter += settled.revenue;
    t.count += 1;
    const method = paymentMethodOf(b);
    paymentMethods[method] = (paymentMethods[method] || 0) + 1;
    if (c) {
      // Grouped by the currency the customer was charged in.
      const ccur = c.currency || cur;
      const ct = correctionTotals[ccur] ||= { count: 0, extraCost: 0, collected: 0, pending: 0, absorbed: 0, credited: 0 };
      ct.count += 1;
      ct.extraCost += convert((c.newCost || 0) - (c.originalCost || 0), cur, ccur, b.fxRate);
      if (c.status === 'paid') ct.collected += c.amountDue || 0;
      if (['sent', 'disputed'].includes(c.status)) ct.pending += c.amountDue || 0;
      if (['absorbed', 'waived'].includes(c.status) && c.difference > 0) ct.absorbed += c.difference;
      if (['credited', 'refunded'].includes(c.status)) ct.credited += c.creditAmount || 0;
    }
  }
  const bookedByCurrency = Object.fromEntries(Object.entries(byCurrency).map(([cur, t]) => [cur, {
    shipments: t.count,
    cost: round2(t.cost),
    sell: round2(t.sell),
    grossMargin: round2(t.sell - t.cost),
    marginPct: t.cost ? round1((t.sell / t.cost - 1) * 100) : null,
    // After carrier corrections are settled (corrected cost, + collected, - credited back).
    marginAfterCorrections: round2(t.revenueAfter - t.costAfter),
  }]));
  const carrierCorrections = Object.fromEntries(Object.entries(correctionTotals).map(([cur, t]) => [cur, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === 'count' ? v : round2(v)]))]));

  return {
    months,
    quotes: quotes.length,
    rateOptions: rates.length,
    shipmentsBooked: bookings.length,
    conversionPct: quotes.length ? round1((bookings.length / quotes.length) * 100) : 0,
    bookedByCurrency,
    avgAchievedMarkupPct: markups.length ? round1(markups.reduce((s, v) => s + v, 0) / markups.length) : null,
    medianAchievedMarkupPct: round1(percentile(markups, 0.5)),
    adjustedRates: rates.filter(r => r.adjustedAt).length, // price overrides
    carrierCorrections,
    paymentMethods,
    receivables: await receivables(),
  };
}

// Money owed right now (not limited to the window): monthly statements, carrier-correction
// balances, bookings awaiting a QuickBooks link payment — and store credit IFF owes customers.
async function receivables() {
  const now = new Date();
  const [statements, adjustments, awaiting, companies] = await Promise.all([
    Statement.find({ status: { $in: ['open', 'partially_paid'] } }).select('amountDue paidAmount dueDate').lean(),
    Adjustment.find({ status: { $in: ['sent', 'disputed'] } }).select('amountDue currency dueDate status').lean(),
    Booking.find({ status: 'awaiting_payment' }).select('sellRate currency chargeAmount chargeCurrency').lean()
      .then(rows => rows.map(b => ({ amount: b.chargeAmount ?? b.sellRate, currency: b.chargeCurrency || b.currency }))),
    Company.find({ $or: [{ 'credit.CAD': { $gt: 0 } }, { 'credit.USD': { $gt: 0 } }, { 'accountHold.active': true }] }).select('credit accountHold').lean(),
  ]);
  const sum = (rows, f) => round2(rows.reduce((n, r) => n + (f(r) || 0), 0));
  const byCur = (rows, f) => ({ CAD: sum(rows.filter(r => (r.currency || 'CAD') === 'CAD'), f), USD: sum(rows.filter(r => r.currency === 'USD'), f) });
  const overdueStatements = statements.filter(st => st.dueDate && new Date(st.dueDate) < now);
  const overdueAdjustments = adjustments.filter(a => a.status === 'sent' && a.dueDate && new Date(a.dueDate) < now);
  return {
    statementsOutstandingCad: sum(statements, st => st.amountDue - (st.paidAmount || 0)),
    statementsOverdueCad: sum(overdueStatements, st => st.amountDue - (st.paidAmount || 0)),
    openStatements: statements.length,
    correctionsDue: byCur(adjustments, a => a.amountDue),
    correctionsOverdue: byCur(overdueAdjustments, a => a.amountDue),
    awaitingLinkPayment: { count: awaiting.length, ...byCur(awaiting, b => b.amount) },
    storeCreditOwed: { CAD: sum(companies, c => c.credit?.CAD), USD: sum(companies, c => c.credit?.USD) },
    accountsOnHold: companies.filter(c => c.accountHold?.active).length,
  };
}

// Runs a draft rule set against a sample shipment — the "see the effect before publishing"
// calculator. priceQuote() is pure, so nothing is written.
function preview(ruleSetDraft, shipment) {
  return priceQuote(shipment, { ...ruleSetDraft, version: 'draft' });
}

module.exports = { listQuotesForAdmin, adjustQuoteRate, calibrationReport, summary, preview };
