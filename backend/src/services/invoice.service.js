const Invoice = require('../models/Invoice');

// Generate a sequential invoice number (INV-YYYYMM-NNNN)
async function generateInvoiceNumber() {
  const { nextNumber } = require('../utils/trackingGenerator');
  const now = new Date();
  return nextNumber(Invoice, 'invoiceNumber', `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`, 4);
}

// Create an invoice for a booking (called automatically after successful booking)
async function createInvoiceForBooking(booking, companyId, userId) {
  const invoiceNumber = await generateInvoiceNumber();

  const invoice = await Invoice.create({
    invoiceNumber,
    company: companyId,
    user: userId,
    // What the customer pays, in the currency they chose.
    totalAmount: booking.chargeAmount ?? booking.sellRate,
    currency: booking.chargeCurrency || booking.currency,
    status: booking.paymentStatus === 'paid' ? 'paid' : 'pending',
    paidAt: booking.paymentStatus === 'paid' ? new Date() : undefined,
    items: [{
      booking: booking._id,
      description: `${booking.carrierName} ${booking.serviceName} — Booking ${booking.bookingNumber}`,
      amount: booking.chargeAmount ?? booking.sellRate,
    }],
  });

  return invoice;
}

module.exports = { createInvoiceForBooking, generateInvoiceNumber };
