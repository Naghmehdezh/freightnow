const Invoice = require('../models/Invoice');

// Generate a sequential invoice number (INV-YYYYMM-NNNN)
async function generateInvoiceNumber() {
  const now = new Date();
  const prefix = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const count = await Invoice.countDocuments({
    invoiceNumber: { $regex: `^${prefix}` },
  });
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

// Create an invoice for a booking (called automatically after successful booking)
async function createInvoiceForBooking(booking, companyId, userId) {
  const invoiceNumber = await generateInvoiceNumber();

  const invoice = await Invoice.create({
    invoiceNumber,
    company: companyId,
    user: userId,
    totalAmount: booking.sellRate,
    currency: booking.currency,
    status: booking.paymentStatus === 'paid' ? 'paid' : 'pending',
    paidAt: booking.paymentStatus === 'paid' ? new Date() : undefined,
    items: [{
      description: `${booking.carrierName} ${booking.serviceName} — Booking ${booking.bookingNumber}`,
      amount: booking.sellRate,
    }],
  });

  return invoice;
}

module.exports = { createInvoiceForBooking, generateInvoiceNumber };
