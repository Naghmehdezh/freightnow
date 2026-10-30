const Shipment = require('../models/Shipment');
const Quote = require('../models/Quote');
const Booking = require('../models/Booking');
const Claim = require('../models/Claim');
const Invoice = require('../models/Invoice');
const SpotRateRequest = require('../models/SpotRateRequest');
const GuestQuoteRequest = require('../models/GuestQuoteRequest');

async function generateTrackingNumber() {
  const year = new Date().getFullYear();
  const count = await Shipment.countDocuments();
  const seq = String(count + 1).padStart(5, '0');
  return `IFF-${year}-${seq}`;
}

async function generateQuoteNumber() {
  const year = new Date().getFullYear();
  const count = await Quote.countDocuments();
  const seq = String(count + 1).padStart(4, '0');
  return `Q-${year}-${seq}`;
}

async function generateBookingNumber() {
  const year = new Date().getFullYear();
  const count = await Booking.countDocuments();
  const seq = String(count + 1).padStart(4, '0');
  return `BK-${year}-${seq}`;
}

async function generateClaimNumber() {
  const year = new Date().getFullYear();
  const count = await Claim.countDocuments();
  const seq = String(count + 1).padStart(4, '0');
  return `CLM-${year}-${seq}`;
}

async function generateInvoiceNumber() {
  const year = new Date().getFullYear();
  const count = await Invoice.countDocuments();
  const seq = String(count + 1).padStart(4, '0');
  return `INV-${year}-${seq}`;
}

async function generateSpotRateNumber() {
  const year = new Date().getFullYear();
  const count = await SpotRateRequest.countDocuments();
  const seq = String(count + 1).padStart(4, '0');
  return `SPR-${year}-${seq}`;
}

async function generateGuestQuoteNumber() {
  const year = new Date().getFullYear();
  const count = await GuestQuoteRequest.countDocuments();
  return `GQR-${year}-${String(count + 1).padStart(4, '0')}`;
}

module.exports = { generateGuestQuoteNumber, generateTrackingNumber, generateQuoteNumber, generateBookingNumber, generateClaimNumber, generateInvoiceNumber, generateSpotRateNumber };
