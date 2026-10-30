const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const Company = require('../models/Company');
const PaymentMethod = require('../models/PaymentMethod');
const { generateBookingNumber } = require('../utils/trackingGenerator');
const { NotFoundError, ValidationError } = require('../utils/errors');
const shipmentService = require('./shipment.service');
const activityLogService = require('./activityLog.service');
const qbPayments = require('./qbPayments.service');
const invoiceService = require('./invoice.service');
const fedexAddr = require('./fedexAddressValidation.service');
const dhlAddr = require('./dhlAddressValidation.service');

async function createBooking(userId, {
  quoteId, quoteRateId, customerReference, paymentMethodId,
  shipper, recipient, holdAtLocation, dangerousGoods,
}, { carrierBooking = true } = {}) { // carrierBooking: false for demo data (no carrier API call)
  const quote = await Quote.findOne({ _id: quoteId, user: userId }).populate('user');
  if (!quote) throw new NotFoundError('Quote');
  if (quote.status === 'expired' || (quote.expiresAt && quote.expiresAt < new Date())) {
    throw new ValidationError('This quote has expired');
  }
  if (quote.status === 'booked') throw new ValidationError('This quote has already been booked');

  const selectedRate = await QuoteRate.findOne({ _id: quoteRateId, quote: quote._id });
  if (!selectedRate) throw new NotFoundError('Rate');

  // Options quoted for this shipment that need more details at booking time.
  // Options the booked carrier couldn't include in its price don't apply to this booking.
  const accessorials = parseAccessorials(quote.accessorials).filter(a => !(selectedRate.notIncludedOptions || []).includes(a));
  const isParcel = ['parcel', 'envelope'].includes(quote.shipmentType);
  if (accessorials.includes('hold_at_location') && selectedRate.carrierId === 'fedex' && !holdAtLocation) {
    throw new ValidationError('Choose the FedEx location where the shipment will be held.');
  }
  if (isParcel && accessorials.includes('hazmat') && quote.options?.dgType !== 'BATTERY' && !dangerousGoods) {
    throw new ValidationError('Dangerous goods details (UN number, shipping name, class, quantity, emergency phone) are required.');
  }

  const company = quote.user.company ? await Company.findById(quote.user.company) : null;
  const bookingInput = { shipper, recipient, holdAtLocation, dangerousGoods };

  // Validate origin and destination addresses via FedEx + DHL (server-side gate).
  // Address is considered valid if at least one carrier validates it.
  try {
    const addrOrig = {
      streetLines: [shipper?.street1 || company?.street || quote.originCity || quote.originPostal || ''],
      city: quote.originCity || '',
      postalCode: quote.originPostal || '',
      countryCode: quote.originCountry || 'CA',
    };
    const addrDest = {
      streetLines: [recipient?.street1 || quote.destCity || quote.destPostal || ''],
      city: quote.destCity || '',
      postalCode: quote.destPostal || '',
      countryCode: quote.destCountry || 'US',
    };
    const [fedexOrig, dhlOrig, fedexDest, dhlDest] = await Promise.all([
      fedexAddr.validateAddress(addrOrig).catch(() => ({ valid: null, fallback: true })),
      dhlAddr.validateAddress(addrOrig).catch(() => ({ valid: null, fallback: true })),
      fedexAddr.validateAddress(addrDest).catch(() => ({ valid: null, fallback: true })),
      dhlAddr.validateAddress(addrDest).catch(() => ({ valid: null, fallback: true })),
    ]);
    // Valid if either carrier confirms; only block if both explicitly reject
    const origValid = fedexOrig.valid === true || dhlOrig.valid === true
      || fedexOrig.valid === null || dhlOrig.valid === null; // fallback = allow
    const destValid = fedexDest.valid === true || dhlDest.valid === true
      || fedexDest.valid === null || dhlDest.valid === null;
    if (!origValid) {
      throw new ValidationError('Origin address could not be validated. Please correct the address and try again.');
    }
    if (!destValid) {
      throw new ValidationError('Destination address could not be validated. Please correct the address and try again.');
    }
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    console.error('[BOOKING] Address validation error (proceeding):', err.message);
  }

  // Determine payment terms for this company
  const paymentTerms = company?.paymentTerms || 'card';

  // For card-paying customers, charge before creating the booking
  let paymentResult = null;
  const companyId = company?._id;
  if (paymentTerms === 'card') {
    // Find the payment method (company-scoped)
    let pm;
    if (paymentMethodId) {
      pm = await PaymentMethod.findOne({ _id: paymentMethodId, company: companyId });
    } else {
      pm = await PaymentMethod.findOne({ company: companyId, isDefault: true });
    }
    if (!pm) throw new ValidationError('No payment method on file. Please add a card before booking.');

    // If QuickBooks is connected and card has a token, charge via QB
    if (pm.qbCardToken) {
      try {
        paymentResult = await qbPayments.chargeCard({
          bookingId: null, // Will update after booking is created
          companyId,
          userId,
          amount: selectedRate.displayRate,
          currency: selectedRate.currency || 'CAD',
          paymentMethodId: pm._id,
        });
      } catch (payErr) {
        throw new ValidationError(`Payment failed: ${payErr.message}`);
      }
    }
    // If no QB token (dev/mock mode), skip actual charge but mark as succeeded
  }

  const bookingNumber = await generateBookingNumber();
  const paymentStatus = paymentTerms === 'card' ? 'paid' : 'invoiced';

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const [booking] = await Booking.create([{
        bookingNumber,
        quote: quote._id,
        quoteRate: selectedRate._id,
        user: userId,
        company: quote.user.company,
        carrierId: selectedRate.carrierId,
        carrierName: selectedRate.carrierName,
        serviceName: selectedRate.serviceName,
        costRate: selectedRate.baseRate,
        sellRate: selectedRate.displayRate,
        // The booked rate's own currency (a quote can mix CAD and USD carrier rates).
        currency: selectedRate.currency || 'CAD',
        customerReference,
        paymentStatus,
      }], { session });

      await Quote.updateOne({ _id: quote._id }, { status: 'booked' }, { session });

      const shipment = await shipmentService.createShipmentForBooking(session, booking, quote, selectedRate, bookingInput, company);

      // If we charged via QB, update the payment record with the booking ID
      if (paymentResult) {
        paymentResult.payment.booking = booking._id;
        await paymentResult.payment.save();
      }

      result = { booking, shipment };
    });

    // Attempt real carrier booking (outside transaction — graceful degradation on failure)
    if (carrierBooking) {
      try {
        const carrierResult = await shipmentService.bookWithCarrier(
          result.shipment, quote, selectedRate, company, bookingInput,
        );
        if (carrierResult) {
          result.carrierTrackingNumber = carrierResult.carrierTrackingNumber;
          result.label = carrierResult.label;
          result.manualCarrierBooking = carrierResult.manualCarrierBooking;
        result.pickup = carrierResult.pickup;
        }
      } catch (err) {
        console.error('[BOOKING] Carrier booking failed (using IFF tracking):', err.message);
      }
    }

    // Generate invoice (receipt for card customers, billable for monthly)
    try {
      await invoiceService.createInvoiceForBooking(result.booking, companyId, userId);
    } catch (err) {
      console.error('[INVOICE] Auto-generation failed:', err.message);
    }

    activityLogService.logActivity(userId, quote.user.company, 'booking_created', {
      bookingId: result.booking.id,
      bookingNumber: result.booking.bookingNumber,
      carrierTrackingNumber: result.carrierTrackingNumber || null,
      paymentStatus,
    });
    return result;
  } finally {
    session.endSession();
  }
}

function parseAccessorials(raw) {
  try { return raw ? JSON.parse(raw) : []; } catch { return []; }
}

async function getUserBookings(userId, { status, page = 1, limit = 10 } = {}) {
  const skip = (page - 1) * limit;
  const filter = { user: userId };
  if (status && status !== 'all') filter.status = status;

  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .sort({ bookedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('quote', 'originCity originPostal destCity destPostal shipmentType')
      .lean(),
    Booking.countDocuments(filter),
  ]);

  return { bookings, pagination: { page, limit, total } };
}

async function getBookingById(bookingId, userId) {
  const booking = await Booking.findOne({ _id: bookingId, user: userId }).populate('shipment');
  if (!booking) throw new NotFoundError('Booking');
  return booking;
}

module.exports = { createBooking, getUserBookings, getBookingById };
