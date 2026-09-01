const { Router } = require('express');
const authRoutes = require('./auth.routes');
const rateRoutes = require('./rate.routes');
const quoteRoutes = require('./quote.routes');
const bookingRoutes = require('./booking.routes');
const shipmentRoutes = require('./shipment.routes');
const trackingRoutes = require('./tracking.routes');
const claimRoutes = require('./claim.routes');
const billingRoutes = require('./billing.routes');
const profileRoutes = require('./profile.routes');
const spotRateRoutes = require('./spotRate.routes');
const fedexAccountRoutes = require('./fedexAccount.routes');
const addressRoutes = require('./address.routes');
const quickbooksRoutes = require('./quickbooks.routes');

const router = Router();

router.use('/auth', authRoutes);
router.use('/rate', rateRoutes);
router.use('/quotes', quoteRoutes);
router.use('/bookings', bookingRoutes);
router.use('/shipments', shipmentRoutes);
router.use('/tracking', trackingRoutes);
router.use('/claims', claimRoutes);
router.use('/billing', billingRoutes);
router.use('/profile', profileRoutes);
router.use('/spot-rates', spotRateRoutes);
router.use('/fedex-account', fedexAccountRoutes);
router.use('/addresses', addressRoutes);
router.use('/quickbooks', quickbooksRoutes);

module.exports = router;
