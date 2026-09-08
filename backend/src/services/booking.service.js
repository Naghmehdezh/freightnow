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

async function createBooking(userId, { quoteId, quoteRateId, customerReference, paymentMethodId }) {
  const quote = await Quote.findOne({ _id: quoteId, user: userId }).populate('user');
  if (!quote) throw new NotFoundError('Quote');
  if (quote.status === 'expired') throw new ValidationError('This quote has expired');
  if (quote.status === 'booked') throw new ValidationError('This quote has already been booked');

  const selectedRate = await QuoteRate.findOne({ _id: quoteRateId, quote: quote._id });
  if (!selectedRate) throw new NotFoundError('Rate');

  // Validate origin and destination addresses via FedEx (server-side gate)
  try {
    const [origResult, destResult] = await Promise.all([
      fedexAddr.validateAddress({
        streetLines: [quote.originCity || quote.originPostal || ''],
        city: quote.originCity || '',
        postalCode: quote.originPostal || '',
        countryCode: quote.originCountry || 'CA',
      }),
      fedexAddr.validateAddress({
        streetLines: [quote.destCity || quote.destPostal || ''],
        city: quote.destCity || '',
        postalCode: quote.destPostal || '',
        countryCode: quote.destCountry || 'US',
      }),
    ]);
    if (origResult.valid === false) {
      throw new ValidationError('Origin address could not be validated by FedEx. Please correct the address and try again.');
    }
    if (destResult.valid === false) {
      throw new ValidationError('Destination address could not be validated by FedEx. Please correct the address and try again.');
    }
    // If FedEx is unavailable (fallback: true), allow booking to proceed
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    console.error('[BOOKING] Address validation error (proceeding):', err.message);
  }

  // Determine payment terms for this company
  const company = quote.user.company ? await Company.findById(quote.user.company) : null;
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
          currency: quote.currency,
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
        currency: quote.currency,
        customerReference,
        paymentStatus,
      }], { session });

      await Quote.updateOne({ _id: quote._id }, { status: 'booked' }, { session });

      const shipment = await shipmentService.createShipmentForBooking(session, booking, quote, selectedRate);

      // If we charged via QB, update the payment record with the booking ID
      if (paymentResult) {
        paymentResult.payment.booking = booking._id;
        await paymentResult.payment.save();
      }

      result = { booking, shipment };
    });

    // Attempt real carrier booking (outside transaction — graceful degradation on failure)
    try {
      const carrierResult = await shipmentService.bookWithCarrier(
        result.shipment, quote, selectedRate, company,
      );
      if (carrierResult) {
        result.carrierTrackingNumber = carrierResult.carrierTrackingNumber;
        result.label = carrierResult.label;
      }
    } catch (err) {
      console.error('[BOOKING] Carrier booking failed (using IFF tracking):', err.message);
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
