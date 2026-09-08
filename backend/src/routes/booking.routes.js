const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const bookingService = require('../services/booking.service');
const { objectId } = require('../utils/validators');

const router = Router();

const bookSchema = z.object({
  quoteId: objectId(),
  quoteRateId: objectId(),
  customerReference: z.string().optional(),
  paymentMethodId: z.string().optional(),
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
    res.status(201).json(response);
  } catch (err) { next(err); }
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
