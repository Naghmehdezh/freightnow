const Booking = require('../models/Booking');
const bookings = require('../services/booking.service');

// "Pay with QuickBooks link" bookings: every 5 minutes, book the carrier for those whose
// QuickBooks invoice is now paid, and cancel those past their 24-hour deadline. (A QuickBooks
// webhook can replace this polling once the backend has a public URL.)
const EVERY_MS = 5 * 60 * 1000;

async function runOnce() {
  try {
    const waiting = await Booking.find({ status: 'awaiting_payment' }).select('_id bookingNumber payBy').lean();
    for (const b of waiting) {
      try {
        const res = await bookings.confirmLinkPayment(b._id);
        if (res.paid) { console.log(`[LINK-PAY] ${b.bookingNumber} paid — booked with the carrier`); continue; }
        if (b.payBy && new Date(b.payBy) < new Date()) {
          await bookings.cancelUnpaidBooking(b._id);
          console.log(`[LINK-PAY] ${b.bookingNumber} not paid in time — cancelled`);
        }
      } catch (err) {
        console.error(`[LINK-PAY] ${b.bookingNumber}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[LINK-PAY] Job failed:', err.message);
  }
}

function startLinkPaymentsJob() {
  if ((process.env.PAYMENT_LINK_JOB || '').toLowerCase() === 'off') return;
  setTimeout(runOnce, 45 * 1000);
  setInterval(runOnce, EVERY_MS).unref();
}

module.exports = { startLinkPaymentsJob, runOnce };
