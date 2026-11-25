const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Quote = require('../models/Quote');
const QuoteRate = require('../models/QuoteRate');
const Company = require('../models/Company');
const Payment = require('../models/Payment');
const Shipment = require('../models/Shipment');
const crypto = require('crypto');
const { getConnectionStatus, ENVIRONMENT: QB_ENVIRONMENT } = require('./quickbooks.service');
const { generateBookingNumber } = require('../utils/trackingGenerator');
const { convert } = require('../utils/currency');
const { getActiveRuleSet } = require('./pricingRules.service');
const { NotFoundError, ValidationError } = require('../utils/errors');
const shipmentService = require('./shipment.service');
const activityLogService = require('./activityLog.service');
const qbPayments = require('./qbPayments.service');
const invoiceService = require('./invoice.service');
const adjustments = require('./adjustment.service');
const accounts = require('./account.service');
const qbInvoices = require('./qbInvoices.service');
const email = require('./email.service');

// "Pay with QuickBooks link": the booking is reserved until the invoice is paid, within this time.
const LINK_PAY_HOURS = 24;
const fedexAddr = require('./fedexAddressValidation.service');
const dhlAddr = require('./dhlAddressValidation.service');

async function createBooking(userId, {
  quoteId, quoteRateId, customerReference, cardToken, measurementsConfirmed, paymentMethod = 'card', chargeCurrency,
  shipper, recipient, holdAtLocation, dangerousGoods, customs,
}, { carrierBooking = true, takePayment = true } = {}) { // both false for demo data (no carrier call, no charge)
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
  // International parcels go through customs: DHL and FedEx need the contents and HS code.
  const international = (quote.originCountry || 'CA').toUpperCase() !== (quote.destCountry || 'CA').toUpperCase();
  if (international && quote.shipmentType === 'parcel' && ['fedex', 'dhl'].includes(selectedRate.carrierId) && !customs) {
    throw new ValidationError('For an international parcel, enter what is inside, its HS code and the country it was made in.');
  }

  const bookingInput = { shipper, recipient, holdAtLocation, dangerousGoods, customs };

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

  // The customer pays in the currency they chose (CAD or USD), converted at the exchange rate
  // locked on the quote. The carrier's own currency is kept on the booking for cost/margin.
  const rateCurrency = selectedRate.currency || 'CAD';
  const payCurrency = ['CAD', 'USD'].includes(chargeCurrency) ? chargeCurrency : rateCurrency;
  const fxRate = selectedRate.fxRate || (await getActiveRuleSet().catch(() => null))?.usdToCadRate || 1.4;
  const chargeAmount = convert(selectedRate.displayRate, rateCurrency, payCurrency, fxRate);

  const companyId = company?._id;
  // An overdue price adjustment puts the account on hold: no new bookings until it's paid.
  if (takePayment && companyId) {
    const hold = await adjustments.refreshHold(companyId);
    if (hold.active) throw new ValidationError(`Your account is on hold (${hold.reason}). Please pay the overdue balance under Billing, then book again.`);
    // Monthly-terms accounts book against their credit limit.
    if (paymentTerms === 'monthly') await accounts.checkCredit(company, chargeAmount, payCurrency);
  }

  // Card customers pay at booking. Store credit (in the rate's currency) is used first; the rest
  // goes on the card. The card never reaches IFF: the browser exchanged it with QuickBooks
  // Payments for a one-time token, which is charged here, once, before booking.
  let charge = null; // { qbTransactionId, test? } for the card part
  let creditUsed = 0;
  let linkAmount = 0; // "Pay with QuickBooks link": amount the invoice is for
  const price = chargeAmount;
  const currency = payCurrency;
  if (paymentTerms === 'card' && takePayment) {
    creditUsed = await adjustments.takeCredit(companyId, currency, price);
    const toCharge = Math.round((price - creditUsed) * 100) / 100;
    if (toCharge > 0 && paymentMethod === 'qb_link') {
      // Pay later through a QuickBooks invoice link: reserve now, book the carrier once paid.
      const qb = await getConnectionStatus();
      if (!qb.connected) {
        await adjustments.returnCredit(companyId, currency, creditUsed);
        throw new ValidationError('Payment links aren\'t available right now. Please pay by card.');
      }
      linkAmount = toCharge;
    } else if (toCharge > 0) {
      try {
        if (!cardToken) throw new ValidationError('Enter your card details to pay for this booking.');
        const qb = await getConnectionStatus();
        if (qb.connected) {
          try {
            const res = await qbPayments.chargeToken({
              token: cardToken,
              amount: toCharge,
              currency,
              usdToCad: fxRate,
              requestId: crypto.randomUUID().replace(/-/g, ''), // Intuit allows at most 50 characters
            });
            charge = { qbTransactionId: res.id, amount: toCharge };
          } catch (payErr) {
            throw new ValidationError(`Payment failed: ${payErr.message}`);
          }
        } else if (QB_ENVIRONMENT === 'sandbox') {
          // Development without a QuickBooks connection: record a clearly-marked test payment.
          console.warn('[BOOKING] QuickBooks not connected (sandbox) — card not charged, test payment recorded');
          charge = { qbTransactionId: null, test: true, amount: toCharge };
        } else {
          // Never mark a card booking paid without taking the money.
          throw new ValidationError('Card payments are temporarily unavailable. Please contact IFF to complete this booking.');
        }
      } catch (err) {
        await adjustments.returnCredit(companyId, currency, creditUsed); // nothing was booked
        throw err;
      }
    }
  }

  const bookingNumber = await generateBookingNumber();
  const awaitingLink = linkAmount > 0;
  const paymentStatus = awaitingLink ? 'awaiting_payment' : paymentTerms === 'card' ? 'paid' : 'invoiced';
  const payBy = awaitingLink ? new Date(Date.now() + LINK_PAY_HOURS * 3600000) : undefined;

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
        currency: rateCurrency,
        chargeCurrency: payCurrency,
        chargeAmount,
        fxRate,
        customerReference,
        paymentStatus,
        status: awaitingLink ? 'awaiting_payment' : 'confirmed',
        paymentMethod: awaitingLink ? 'qb_link' : paymentTerms === 'monthly' ? 'account' : charge ? 'card' : creditUsed > 0 ? 'credit' : undefined,
        ...(awaitingLink && { payBy, pendingInput: bookingInput }),
        // When the customer accepted that carrier re-weighs/re-measures can change the price.
        ...(measurementsConfirmed && { measurementsConfirmedAt: new Date() }),
      }], { session });

      await Quote.updateOne({ _id: quote._id }, { status: 'booked' }, { session });

      const shipment = await shipmentService.createShipmentForBooking(session, booking, quote, selectedRate, bookingInput, company);

      // How it was paid, recorded against the booking (no card data — just QuickBooks' reference).
      if (creditUsed > 0) {
        await Payment.create([{ booking: booking._id, user: userId, amount: creditUsed, currency, qbTransactionId: 'store-credit', status: 'succeeded', method: 'credit' }], { session });
      }
      if (charge) {
        await Payment.create([{
          booking: booking._id,
          user: userId,
          amount: charge.amount,
          currency,
          qbTransactionId: charge.qbTransactionId || (charge.test ? `sandbox-not-charged-${booking.bookingNumber}` : null),
          status: 'succeeded',
          method: 'card',
        }], { session });
      }

      result = { booking, shipment, creditApplied: creditUsed };
    });

    // Reserved until paid: create the QuickBooks invoice and its Pay-now link; the carrier is
    // booked later, by confirmLinkPayment().
    if (awaitingLink) {
      try {
        const inv = await qbInvoices.createInvoice({
          company, user: quote.user, amount: linkAmount, currency, bookingNumber,
          description: `${selectedRate.carrierName} ${selectedRate.serviceName} — booking ${bookingNumber} (${quote.originCity || quote.originPostal} → ${quote.destCity || quote.destPostal})`,
          dueDate: payBy, usdToCad: fxRate,
        });
        await Booking.updateOne({ _id: result.booking._id }, { qbInvoiceId: inv.qbInvoiceId, qbInvoiceLink: inv.invoiceLink });
        Object.assign(result, { paymentLink: inv.invoiceLink, payBy, awaitingPayment: true });
      } catch (err) {
        await cancelUnpaidBooking(result.booking._id, 'the payment link could not be created', { notify: false });
        throw err instanceof ValidationError ? err : new ValidationError(`Could not create the payment link: ${err.message}`);
      }
      email.sendPaymentLink(result.booking, quote.user, result.paymentLink, payBy, linkAmount, currency);
      activityLogService.logActivity(userId, quote.user.company, 'booking_reserved', { bookingNumber, amount: linkAmount, currency, payBy });
      return result;
    }

    Object.assign(result, await finishBooking({
      booking: result.booking, shipment: result.shipment, quote, selectedRate, company, bookingInput, userId, carrierBooking,
    }));
    return result;
  } finally {
    session.endSession();
  }
}

// After payment: book with the carrier (pickup included), issue IFF's invoice, log it.
async function finishBooking({ booking, shipment, quote, selectedRate, company, bookingInput, userId, carrierBooking = true }) {
  const out = {};
  // Attempt real carrier booking (graceful degradation on failure)
  if (carrierBooking) {
    try {
      const carrierResult = await shipmentService.bookWithCarrier(shipment, quote, selectedRate, company, bookingInput);
      if (carrierResult) {
        out.carrierTrackingNumber = carrierResult.carrierTrackingNumber;
        out.label = carrierResult.label;
        out.manualCarrierBooking = carrierResult.manualCarrierBooking;
        out.pickup = carrierResult.pickup;
      }
    } catch (err) {
      console.error('[BOOKING] Carrier booking failed (using IFF tracking):', err.message);
    }
  }

  // Generate invoice (receipt for card customers, billable for monthly)
  try {
    await invoiceService.createInvoiceForBooking(booking, company?._id, userId);
  } catch (err) {
    console.error('[INVOICE] Auto-generation failed:', err.message);
  }

  activityLogService.logActivity(userId, quote.user?.company || booking.company, 'booking_created', {
    bookingId: String(booking._id),
    bookingNumber: booking.bookingNumber,
    carrierTrackingNumber: out.carrierTrackingNumber || null,
    paymentStatus: booking.paymentStatus,
  });
  return out;
}

// ─── "Pay with QuickBooks link" bookings ───────────────────────────

// Checks the QuickBooks invoice; once paid, books the carrier. Safe to call repeatedly (job,
// "check payment" button): only the first call that sees it paid completes the booking.
async function confirmLinkPayment(bookingId) {
  const pending = await Booking.findById(bookingId);
  if (!pending) throw new NotFoundError('Booking');
  if (pending.status !== 'awaiting_payment') return { status: pending.status, paymentStatus: pending.paymentStatus };
  if (!pending.qbInvoiceId) return { status: pending.status, paid: false };

  const { balance, total } = await qbInvoices.getInvoiceBalance(pending.qbInvoiceId);
  if (balance > 0.005) return { status: 'awaiting_payment', paid: false, balance };

  // Claim it (only one caller proceeds).
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, status: 'awaiting_payment' },
    { status: 'confirmed', paymentStatus: 'paid' },
    { new: true },
  );
  if (!booking) return { status: 'confirmed', paid: true };

  await Payment.create({ booking: booking._id, user: booking.user, amount: total, currency: booking.chargeCurrency || booking.currency, qbTransactionId: `qb-invoice-${booking.qbInvoiceId}`, status: 'succeeded', method: 'qb_link' });
  const [quote, selectedRate, company, shipment] = await Promise.all([
    Quote.findById(booking.quote).populate('user'),
    QuoteRate.findById(booking.quoteRate),
    booking.company ? Company.findById(booking.company) : null,
    Shipment.findOne({ booking: booking._id }),
  ]);
  const result = await finishBooking({
    booking, shipment, quote, selectedRate, company, bookingInput: booking.pendingInput || {}, userId: booking.user,
  });
  await Booking.updateOne({ _id: booking._id }, { $unset: { pendingInput: 1 } }); // contact details now live on the shipment
  email.sendLinkPaymentReceived(booking, quote.user, result);
  return { status: 'confirmed', paid: true, ...result };
}

// Unpaid by the deadline (or the link couldn't be made): void the QuickBooks invoice, give back any
// store credit, release the quote.
async function cancelUnpaidBooking(bookingId, reason = 'it was not paid within 24 hours', { notify = true } = {}) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, status: 'awaiting_payment' },
    { status: 'cancelled', paymentStatus: 'cancelled', cancelledAt: new Date(), $unset: { pendingInput: 1 } },
    { new: true },
  );
  if (!booking) return null;
  if (booking.qbInvoiceId) {
    try { await qbInvoices.voidInvoice(booking.qbInvoiceId); } catch (err) { console.error('[BOOKING] Could not void QuickBooks invoice:', err.message); }
  }
  const creditPayments = await Payment.find({ booking: booking._id, method: 'credit', status: 'succeeded' });
  for (const p of creditPayments) {
    await adjustments.returnCredit(booking.company, p.currency, p.amount);
    p.status = 'refunded';
    await p.save();
  }
  await Shipment.updateOne({ booking: booking._id }, { status: 'cancelled' });
  await Quote.updateOne({ _id: booking.quote }, { status: 'expired' });
  activityLogService.logActivity(null, booking.company, 'booking_cancelled_unpaid', { bookingNumber: booking.bookingNumber, reason });
  if (notify) {
    const quote = await Quote.findById(booking.quote).populate('user');
    email.sendLinkBookingCancelled(booking, quote?.user, reason);
  }
  return booking;
}

// Sandbox only: the sandbox "Pay now" link is a placeholder page (404), so record a payment on the
// QuickBooks invoice instead, then confirm exactly as the job would.
async function simulateLinkPaymentForUser(user, bookingId) {
  if (QB_ENVIRONMENT !== 'sandbox') throw new ValidationError('Test payments are only available in the QuickBooks sandbox');
  if (!mongoose.isValidObjectId(bookingId)) throw new NotFoundError('Booking');
  const booking = await Booking.findById(bookingId);
  const mine = booking && (String(booking.user) === String(user.id) || (user.companyId && String(booking.company) === String(user.companyId)));
  if (!mine) throw new NotFoundError('Booking');
  if (booking.status !== 'awaiting_payment' || !booking.qbInvoiceId) throw new ValidationError('This booking is not awaiting payment');
  await qbInvoices.simulatePayment(booking.qbInvoiceId);
  return confirmLinkPayment(booking._id);
}

// Customer "I've paid — check now".
async function checkPaymentForUser(user, bookingId) {
  if (!mongoose.isValidObjectId(bookingId)) throw new NotFoundError('Booking');
  const booking = await Booking.findById(bookingId).select('user company');
  const mine = booking && (String(booking.user) === String(user.id) || (user.companyId && String(booking.company) === String(user.companyId)));
  if (!mine) throw new NotFoundError('Booking');
  return confirmLinkPayment(bookingId);
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

module.exports = { createBooking, getUserBookings, getBookingById, confirmLinkPayment, cancelUnpaidBooking, checkPaymentForUser, simulateLinkPaymentForUser };
