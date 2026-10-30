const mongoose = require('mongoose');
const GuestQuoteRequest = require('../models/GuestQuoteRequest');
const { generateGuestQuoteNumber } = require('../utils/trackingGenerator');
const { NotFoundError, ValidationError } = require('../utils/errors');
const { addBusinessDays, endOfDay } = require('../utils/dateHelpers');
const { logActivity } = require('./activityLog.service');
const email = require('./email.service');

// Quote requests from visitors without an account. IFF staff contact them and price by hand.

async function submitGuestQuote(data) {
  const request = await GuestQuoteRequest.create({
    requestNumber: await generateGuestQuoteNumber(),
    name: data.name,
    company: data.company,
    email: data.email,
    phone: data.phone,
    origin: data.origin,
    originType: data.originType,
    destination: data.destination,
    destinationType: data.destinationType,
    mode: data.mode,
    volume: data.volume,
    items: data.items || [],
    termsOfSale: data.termsOfSale,
    hazardous: !!data.hazardous,
    notes: data.notes,
    source: data.source,
  });
  email.sendGuestQuoteNotice(request);
  email.sendGuestQuoteReceipt(request);
  return { requestNumber: request.requestNumber };
}

async function listGuestQuotes({ status, search, page = 1, limit = 50 } = {}) {
  const where = {};
  if (status && status !== 'all') where.status = status;
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    where.$or = [{ requestNumber: rx }, { name: rx }, { company: rx }, { email: rx }];
  }
  const [rows, total] = await Promise.all([
    GuestQuoteRequest.find(where).sort({ submittedAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('handledBy', 'email').populate('quotedBy', 'email').lean(),
    GuestQuoteRequest.countDocuments(where),
  ]);
  return {
    data: rows.map(r => ({
      ...r, id: String(r._id), _id: undefined,
      handledBy: r.handledBy?.email || null,
      quotedBy: r.quotedBy?.email || null,
      // A price past its validity date shows as expired while the request is still "quoted".
      priceExpired: r.status === 'quoted' && r.validUntil ? new Date(r.validUntil) < new Date() : false,
    })),
    pagination: { page, limit, total },
  };
}

async function updateGuestQuote(staffUserId, id, { status, staffNote }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Guest quote request');
  const request = await GuestQuoteRequest.findById(id);
  if (!request) throw new NotFoundError('Guest quote request');
  if (status) request.status = status;
  if (staffNote !== undefined) request.staffNote = staffNote;
  request.handledBy = staffUserId;
  request.handledAt = new Date();
  await request.save();
  logActivity(staffUserId, null, 'guest_quote_updated', { requestNumber: request.requestNumber, status: request.status });
  return { id: String(request._id), status: request.status };
}

async function findForStaff(id) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError('Guest quote request');
  const request = await GuestQuoteRequest.findById(id);
  if (!request) throw new NotFoundError('Guest quote request');
  return request;
}

// Send (or replace) the price for a guest request; the customer is emailed the price.
async function priceGuestQuote(staffUserId, id, { price, currency, carrierCost, carrierName, serviceName, transitDays, validDays = 7, customerNote, staffNote }) {
  const request = await findForStaff(id);
  if (request.status === 'closed') throw new ValidationError('This request is closed — reopen it before sending a new price');
  const repriced = request.quotedRate != null;
  Object.assign(request, {
    status: 'quoted',
    quotedRate: price,
    quotedCurrency: currency,
    carrierCost,
    carrierName,
    serviceName,
    transitDays,
    validUntil: endOfDay(addBusinessDays(new Date(), Number(validDays))),
    customerNote,
    ...(staffNote !== undefined && { staffNote }),
    quotedAt: new Date(),
    quotedBy: staffUserId,
    handledBy: staffUserId,
    handledAt: new Date(),
    declinedAt: undefined,
  });
  await request.save();
  email.sendGuestQuotePrice(request);
  logActivity(staffUserId, null, repriced ? 'guest_quote_repriced' : 'guest_quote_priced', {
    requestNumber: request.requestNumber, price, currency, carrierCost, margin: Math.round((price - carrierCost) * 100) / 100,
  });
  return { id: String(request._id), status: request.status };
}

async function declineGuestQuote(staffUserId, id, { customerNote, staffNote }) {
  const request = await findForStaff(id);
  Object.assign(request, {
    status: 'declined',
    customerNote,
    ...(staffNote !== undefined && { staffNote }),
    declinedAt: new Date(),
    handledBy: staffUserId,
    handledAt: new Date(),
  });
  await request.save();
  email.sendGuestQuoteDeclined(request);
  logActivity(staffUserId, null, 'guest_quote_declined', { requestNumber: request.requestNumber });
  return { id: String(request._id), status: request.status };
}

module.exports = { submitGuestQuote, listGuestQuotes, updateGuestQuote, priceGuestQuote, declineGuestQuote };
