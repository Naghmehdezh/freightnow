const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const bookingService = require('../services/booking.service');
const { objectId } = require('../utils/validators');

const router = Router();

const phone = z.string().trim().regex(/^[+\d\s().-]{7,20}$/, 'Enter a valid phone number');
const contactParty = {
  contactName: z.string().trim().min(1).max(70),
  companyName: z.string().trim().max(70).optional(),
  phone,
  street1: z.string().trim().min(1).max(70),
  street2: z.string().trim().max(70).optional(),
};

const bookSchema = z.object({
  quoteId: objectId(),
  quoteRateId: objectId(),
  customerReference: z.string().optional(),
  // Card customers pay now by card (one-time QuickBooks Payments token from the browser), or
  // choose a QuickBooks invoice link: the booking is reserved and the carrier booked once paid.
  paymentMethod: z.enum(['card', 'qb_link']).optional(),
  // Currency the customer pays in (they can view and pay in CAD or USD).
  chargeCurrency: z.enum(['CAD', 'USD']).optional(),
  cardToken: z.string().trim().min(10).max(200).optional(),
  // The customer confirmed weights/dimensions are accurate and accepted price adjustments.
  measurementsConfirmed: z.literal(true, { errorMap: () => ({ message: 'Please confirm that the weights and dimensions are accurate.' }) }),
  // Street address and contact for each end — the quote only has city/postal code.
  shipper: z.object(contactParty).optional(), // defaults to the company profile
  recipient: z.object({ ...contactParty, email: z.string().email().optional() }),
  // Hold at location: the carrier location picked from /api/fedex/locations.
  holdAtLocation: z.object({
    locationId: z.string().min(1),
    locationType: z.string().min(1),
    name: z.string().optional(),
    address: z.object({
      streetLines: z.array(z.string()).min(1),
      city: z.string(),
      stateOrProvinceCode: z.string().optional(),
      postalCode: z.string(),
      countryCode: z.string().length(2),
    }),
  }).optional(),
  // Fully regulated dangerous goods / small quantity exception (parcel).
  // International parcels: what's inside, for customs (DHL and FedEx need the HS code).
  customs: z.object({
    description: z.string().trim().min(3).max(70),
    hsCode: z.string().trim().transform(v => v.replace(/[.\s]/g, '')).pipe(z.string().regex(/^\d{6,10}$/, 'HS code is 6 to 10 digits, e.g. 6109.10')),
    countryOfManufacture: z.string().trim().length(2).transform(v => v.toUpperCase()),
  }).optional(),
  dangerousGoods: z.object({
    unNumber: z.string().trim().regex(/^(UN|ID)?\d{4}$/i, 'UN number is 4 digits, e.g. UN1263'),
    properShippingName: z.string().trim().min(1).max(100),
    hazardClass: z.string().trim().min(1).max(10),
    packingGroup: z.enum(['I', 'II', 'III']).optional(),
    quantity: z.number().positive(),
    units: z.enum(['L', 'ML', 'KG', 'G']),
    emergencyPhone: phone,
  }).optional(),
});

router.post('/', authenticate, validate(bookSchema), async (req, res, next) => {
  try {
    const result = await bookingService.createBooking(req.user.id, req.validated);
    const response = { booking: result.booking, shipment: result.shipment };
    if (result.carrierTrackingNumber) {
      response.carrierTrackingNumber = result.carrierTrackingNumber;
    }
    if (result.label) {
      response.label = result.label;
    }
    if (result.manualCarrierBooking) {
      response.manualCarrierBooking = result.manualCarrierBooking;
    }
    if (result.pickup) response.pickup = result.pickup; // carrier pickup confirmation / "IFF will arrange it"
    if (result.creditApplied) response.creditApplied = result.creditApplied; // store credit used
    if (result.awaitingPayment) Object.assign(response, { awaitingPayment: true, paymentLink: result.paymentLink, payBy: result.payBy });
    res.status(201).json(response);
  } catch (err) { next(err); }
});

// "I've paid — check now" for a booking reserved with a QuickBooks payment link.
router.post('/:id/check-payment', authenticate, async (req, res, next) => {
  try { res.json(await bookingService.checkPaymentForUser(req.user, req.params.id)); } catch (err) { next(err); }
});

// Sandbox only: stand-in for paying on the (placeholder) sandbox payment page.
router.post('/:id/test-payment', authenticate, async (req, res, next) => {
  try { res.json(await bookingService.simulateLinkPaymentForUser(req.user, req.params.id)); } catch (err) { next(err); }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const result = await bookingService.getUserBookings(req.user.id, {
      status,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const booking = await bookingService.getBookingById(req.params.id, req.user.id);
    res.json(booking);
  } catch (err) { next(err); }
});

module.exports = router;
