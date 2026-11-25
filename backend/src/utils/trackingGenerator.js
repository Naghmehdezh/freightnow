const Shipment = require('../models/Shipment');
const Quote = require('../models/Quote');
const Booking = require('../models/Booking');
const Claim = require('../models/Claim');
const Invoice = require('../models/Invoice');
const SpotRateRequest = require('../models/SpotRateRequest');
const GuestQuoteRequest = require('../models/GuestQuoteRequest');

// Next number in a sequence: the highest existing "<prefix><digits>" + 1. (Counting documents
// instead would hand out a number that's already taken as soon as any record is deleted, and the
// unique index would then reject the new booking/quote/etc.)
async function nextNumber(Model, field, prefix, width) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rows = await Model.find({ [field]: { $regex: `^${escaped}\\d+$` } }).select(field).lean();
  const max = rows.reduce((n, r) => Math.max(n, parseInt(String(r[field]).slice(prefix.length), 10) || 0), 0);
  return `${prefix}${String(max + 1).padStart(width, '0')}`;
}

const year = () => new Date().getFullYear();

async function generateTrackingNumber() {
  return nextNumber(Shipment, 'trackingNumber', `IFF-${year()}-`, 5);
}

async function generateQuoteNumber() {
  return nextNumber(Quote, 'quoteNumber', `Q-${year()}-`, 4);
}

async function generateBookingNumber() {
  return nextNumber(Booking, 'bookingNumber', `BK-${year()}-`, 4);
}

async function generateClaimNumber() {
  return nextNumber(Claim, 'claimNumber', `CLM-${year()}-`, 4);
}

async function generateInvoiceNumber() {
  return nextNumber(Invoice, 'invoiceNumber', `INV-${year()}-`, 4);
}

async function generateSpotRateNumber() {
  return nextNumber(SpotRateRequest, 'requestNumber', `SPR-${year()}-`, 4);
}

async function generateAdjustmentNumber() {
  const Adjustment = require('../models/Adjustment');
  return nextNumber(Adjustment, 'adjustmentNumber', `ADJ-${year()}-`, 4);
}

async function generateGuestQuoteNumber() {
  return nextNumber(GuestQuoteRequest, 'requestNumber', `GQR-${year()}-`, 4);
}

module.exports = { nextNumber, generateAdjustmentNumber, generateGuestQuoteNumber, generateTrackingNumber, generateQuoteNumber, generateBookingNumber, generateClaimNumber, generateInvoiceNumber, generateSpotRateNumber };
