const mongoose = require('mongoose');
const SpotRateRequest = require('../models/SpotRateRequest');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const User = require('../models/User');
const { generateSpotRateNumber, generateQuoteNumber } = require('../utils/trackingGenerator');
const { addBusinessDays, formatDate, endOfDay } = require('../utils/dateHelpers');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { getActiveRuleSet } = require('./pricingRules.service');
const { logActivity } = require('./activityLog.service');
const email = require('./email.service');

// Spot rates are FTL / air / ocean shipments IFF prices by hand. When staff price one, a normal
// Quote with a single "IFF Cargo" QuoteRate is created, so the customer books it through the
// usual booking flow (POST /api/bookings) — IFF arranges the carrier itself.
const SPOT_CARRIER = { carrierId: 'iff', carrierName: 'IFF Cargo' };
const DEFAULT_SERVICE = { ftl: 'FTL — spot rate', air: 'Air freight — spot rate', ocean: 'Ocean freight — spot rate' };

// Volume weight in kg for one group: L×W×H / 6000 when in cm, / 366 when in inches, per piece.
function volumeWeightKg({ pieces, length, width, height, unit }) {
  const perPiece = (length * width * height) / (unit === 'in' ? 366 : 6000);
  return Math.round(perPiece * pieces * 100) / 100;
}

async function submitSpotRate(userId, data) {
  const requestNumber = await generateSpotRateNumber();
  const packages = (data.packages || []).map(p => ({ ...p, volumeWeightKg: volumeWeightKg(p) }));
  const volumeWeight = packages.length ? Math.round(packages.reduce((s, p) => s + p.volumeWeightKg, 0) * 100) / 100 : undefined;
  const weightUnit = data.weightUnit || (data.shipmentType === 'ftl' ? 'lb' : 'kg');
  const actualKg = data.weight ? (weightUnit === 'kg' ? data.weight : data.weight / 2.20462) : 0;

  const spotRate = await SpotRateRequest.create({
    requestNumber,
    user: userId,
    shipmentType: data.shipmentType,
    airService: data.shipmentType === 'air' ? data.airService : undefined,
    originStreet: data.origin.street,
    originCity: data.origin.city,
    originProvince: data.origin.province,
    originPostal: data.origin.postalCode,
    originCountry: data.origin.country,
    destCity: data.destination.city,
    destProvince: data.destination.province,
    destPostal: data.destination.postalCode,
    destCountry: data.destination.country,
    originPort: data.originPort,
    destPort: data.destPort,
    oceanType: data.shipmentType === 'ocean' ? data.oceanType : undefined,
    weight: data.weight,
    weightUnit,
    pieces: packages.length ? packages.reduce((s, p) => s + p.pieces, 0) : (data.skids || undefined),
    skids: data.shipmentType === 'ftl' ? data.skids : undefined,
    packages,
    volumeWeightKg: volumeWeight,
    chargeableWeightKg: volumeWeight != null ? Math.round(Math.max(actualKg, volumeWeight) * 100) / 100 : undefined,
    commodity: data.commodity,
    specialNotes: data.specialNotes,
  });

  const user = await User.findById(userId).select('email company');
  email.sendSpotRateRequestNotice(spotRate, user);
  logActivity(userId, user?.company, 'spot_rate_submitted', { requestNumber, shipmentType: data.shipmentType });

  return toCustomerView(spotRate);
}

// Status the customer sees: a quoted request becomes "booked" once its quote is booked,
// or "expired" after its validity date.
function effectiveStatus(r) {
  if (r.status === 'quoted') {
    if (r.quote?.status === 'booked') return 'booked';
    if (r.validUntil && new Date(r.validUntil) < new Date()) return 'expired';
  }
  return r.status;
}

// Customer view — never includes IFF's carrier cost, carrier or internal notes.
function toCustomerView(r) {
  const o = r.toObject ? r.toObject() : r;
  return {
    id: String(o._id),
    requestNumber: o.requestNumber,
    shipmentType: o.shipmentType,
    airService: o.airService,
    origin: { street: o.originStreet, city: o.originCity, province: o.originProvince, postalCode: o.originPostal, country: o.originCountry, port: o.originPort },
    destination: { city: o.destCity, province: o.destProvince, postalCode: o.destPostal, country: o.destCountry, port: o.destPort },
    oceanType: o.oceanType,
    weight: o.weight,
    weightUnit: o.weightUnit || 'lb',
    pieces: o.pieces,
    skids: o.skids,
    dimensions: o.dimensions,
    packages: o.packages || [],
    volumeWeightKg: o.volumeWeightKg,
    chargeableWeightKg: o.chargeableWeightKg,
    pickupDate: o.pickupDate,
    commodity: o.commodity,
    declaredValue: o.declaredValue,
    specialNotes: o.specialNotes,
    status: effectiveStatus(o),
    submittedAt: o.submittedAt,
    ...(o.status === 'quoted' && {
      price: o.quotedRate,
      currency: o.quotedCurrency,
      serviceName: o.serviceName,
      transitDays: o.transitDays,
      validUntil: o.validUntil,
      quotedAt: o.quotedAt,
      quoteId: o.quote?._id ? String(o.quote._id) : (o.quote ? String(o.quote) : null),
      quoteRateId: o.quoteRate ? String(o.quoteRate._id || o.quoteRate) : null,
    }),
    ...(o.customerNote && { customerNote: o.customerNote }),
  };
}

async function getUserSpotRates(userId, { page = 1, limit = 10 } = {}) {
  const skip = (page - 1) * limit;

  const [spotRates, total] = await Promise.all([
    SpotRateRequest.find({ user: userId }).sort({ submittedAt: -1 }).skip(skip).limit(limit)
      .populate('quote', 'status expiresAt'),
    SpotRateRequest.countDocuments({ user: userId }),
  ]);

  return { spotRates: spotRates.map(toCustomerView), pagination: { page, limit, total } };
}

async function getSpotRateById(spotRateId, userId) {
  if (!mongoose.isValidObjectId(spotRateId)) throw new NotFoundError('Spot rate request');
  const spotRate = await SpotRateRequest.findOne({ _id: spotRateId, user: userId }).populate('quote', 'status expiresAt');
  if (!spotRate) throw new NotFoundError('Spot rate request');
  return toCustomerView(spotRate);
}

// ─── IFF staff ───────────────────────────────────────────────────

async function listSpotRates({ status, search, page = 1, limit = 20 } = {}) {
  const where = {};
  if (status === 'pending' || status === 'declined') where.status = status;
  if (status === 'quoted' || status === 'booked' || status === 'expired') where.status = 'quoted';
  if (search) where.requestNumber = new RegExp(search.replace(/[^\w-]/g, ''), 'i');

  const docs = await SpotRateRequest.find(where).sort({ submittedAt: -1 })
    .populate({ path: 'user', select: 'email firstName lastName phone company', populate: { path: 'company', select: 'name' } })
    .populate('quote', 'status expiresAt quoteNumber')
    .populate('quotedBy', 'email');

  // booked / expired are derived from the linked quote, so they're filtered after loading.
  const rows = docs
    .map(d => ({ doc: d, status: effectiveStatus(d) }))
    .filter(r => !status || status === 'all' || r.status === status);
  const total = rows.length;
  const pageRows = rows.slice((page - 1) * limit, page * limit);

  return {
    data: pageRows.map(({ doc, status: st }) => ({
      ...toCustomerView(doc),
      status: st,
      customer: {
        email: doc.user?.email,
        name: [doc.user?.firstName, doc.user?.lastName].filter(Boolean).join(' '),
        phone: doc.user?.phone,
        company: doc.user?.company?.name,
      },
      // internal fields
      price: doc.quotedRate,
      currency: doc.quotedCurrency,
      carrierCost: doc.carrierCost,
      carrierName: doc.carrierName,
      serviceName: doc.serviceName,
      transitDays: doc.transitDays,
      validUntil: doc.validUntil,
      staffNote: doc.staffNote,
      quotedBy: doc.quotedBy?.email,
      quoteNumber: doc.quote?.quoteNumber,
      declinedAt: doc.declinedAt,
    })),
    pagination: { page, limit, total },
  };
}

async function quoteSpotRate(staffUserId, spotRateId, { price, currency, carrierCost, carrierName, serviceName, transitDays, validDays = 7, customerNote, staffNote }) {
  if (!mongoose.isValidObjectId(spotRateId)) throw new NotFoundError('Spot rate request');
  const request = await SpotRateRequest.findById(spotRateId).populate('quote', 'status');
  if (!request) throw new NotFoundError('Spot rate request');
  if (request.status === 'declined') throw new ValidationError('This request was declined');
  if (request.quote?.status === 'booked') throw new ValidationError('This spot rate has already been booked');

  const ruleSet = await getActiveRuleSet();
  const fx = currency === 'USD' ? (ruleSet.usdToCadRate || 1.4) : 1;
  const validUntil = endOfDay(addBusinessDays(new Date(), Number(validDays)));
  const shipDate = request.pickupDate && request.pickupDate >= formatDate(new Date()) ? request.pickupDate : formatDate(addBusinessDays(new Date(), 1));
  const estimatedDelivery = formatDate(addBusinessDays(new Date(`${shipDate}T12:00:00`), Number(transitDays)));

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Re-quoting replaces the earlier offer.
      if (request.quote) await Quote.updateOne({ _id: request.quote._id }, { status: 'expired' }, { session });

      const [quote] = await Quote.create([{
        quoteNumber: await generateQuoteNumber(),
        user: request.user,
        shipmentType: request.shipmentType,
        originCity: request.originCity || request.originPort,
        originProvince: request.originProvince,
        originPostal: request.originPostal,
        originCountry: request.originCountry,
        destCity: request.destCity || request.destPort,
        destProvince: request.destProvince,
        destPostal: request.destPostal,
        destCountry: request.destCountry,
        // Quotes/shipments store pounds; FCL requests have no weight.
        weight: request.weight ? Math.round((request.weightUnit === 'kg' ? request.weight * 2.20462 : request.weight) * 10) / 10 : 0,
        pieces: request.pieces || 1,
        currency,
        pickupDate: shipDate,
        declaredValue: request.declaredValue,
        commodity: request.commodity,
        expiresAt: validUntil,
      }], { session });

      const [rate] = await QuoteRate.create([{
        quote: quote._id,
        ...SPOT_CARRIER,
        serviceName: serviceName || DEFAULT_SERVICE[request.shipmentType] || 'Spot rate',
        currency,
        baseRate: carrierCost,
        displayRate: price,
        engineRate: price,
        transitDays,
        estimatedDelivery,
        isLiveRate: false,
        isBestRate: true,
        markupPct: carrierCost > 0 ? Math.round((price / carrierCost - 1) * 1000) / 10 : null,
        grossMargin: Math.round((price - carrierCost) * 100) / 100,
        costCad: Math.round(carrierCost * fx * 100) / 100,
        sellCad: Math.round(price * fx * 100) / 100,
        fxRate: fx,
        flags: ['spot_rate'],
      }], { session });

      Object.assign(request, {
        status: 'quoted',
        quotedRate: price,
        quotedCurrency: currency,
        carrierCost,
        carrierName,
        serviceName: rate.serviceName,
        transitDays,
        validUntil,
        customerNote,
        staffNote,
        quotedAt: new Date(),
        quotedBy: staffUserId,
        quote: quote._id,
        quoteRate: rate._id,
      });
      await request.save({ session });
    });
  } finally {
    await session.endSession();
  }

  const customer = await User.findById(request.user).select('email company');
  email.sendSpotRateQuotedNotice(request, customer);
  logActivity(staffUserId, customer?.company, 'spot_rate_quoted', { requestNumber: request.requestNumber, price, currency, carrierCost });
  return { id: String(request._id), status: 'quoted', quoteId: String(request.quote), quoteRateId: String(request.quoteRate) };
}

async function declineSpotRate(staffUserId, spotRateId, { customerNote, staffNote }) {
  if (!mongoose.isValidObjectId(spotRateId)) throw new NotFoundError('Spot rate request');
  const request = await SpotRateRequest.findById(spotRateId).populate('quote', 'status');
  if (!request) throw new NotFoundError('Spot rate request');
  if (request.quote?.status === 'booked') throw new ValidationError('This spot rate has already been booked');

  if (request.quote) await Quote.updateOne({ _id: request.quote._id }, { status: 'expired' });
  Object.assign(request, { status: 'declined', declinedAt: new Date(), customerNote, staffNote, quotedBy: staffUserId });
  await request.save();

  const customer = await User.findById(request.user).select('email company');
  email.sendSpotRateDeclinedNotice(request, customer);
  logActivity(staffUserId, customer?.company, 'spot_rate_declined', { requestNumber: request.requestNumber });
  return { id: String(request._id), status: 'declined' };
}

module.exports = { submitSpotRate, getUserSpotRates, getSpotRateById, listSpotRates, quoteSpotRate, declineSpotRate };
