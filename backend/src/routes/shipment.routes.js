const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const shipmentService = require('../services/shipment.service');

const router = Router();

// Booking a quote now happens via POST /api/bookings (see booking.routes.js) — a Shipment
// is created as a side effect of a confirmed Booking, not directly. This router is read-only.

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { status, page, limit, search } = req.query;
    const result = await shipmentService.getUserShipments(req.user.id, {
      status,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      search,
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const shipment = await shipmentService.getShipmentById(req.params.id, req.user.id);
    res.json(shipment);
  } catch (err) { next(err); }
});

router.get('/:id/label', authenticate, async (req, res, next) => {
  try {
    const label = await shipmentService.getShipmentLabel(req.params.id, req.user.id);
    if (!label) return res.status(404).json({ error: { code: 'NO_LABEL', message: 'No label available for this shipment' } });
    res.json(label);
  } catch (err) { next(err); }
});

module.exports = router;
