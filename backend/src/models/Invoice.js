const mongoose = require('mongoose');
const { Schema } = mongoose;

// Embedded, not a separate collection — InvoiceItem isn't one of the guide's 17 named
// collections, and the guide describes an invoice as holding "a list of bookings" (an array
// field), not a separate table.
const invoiceItemSchema = new Schema({
  shipment: { type: Schema.Types.ObjectId, ref: 'Shipment' },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  description: { type: String, required: true },
  amount: { type: Number, required: true },
});

const invoiceSchema = new Schema({
  invoiceNumber: { type: String, required: true, unique: true },
  company: { type: Schema.Types.ObjectId, ref: 'Company' },
  user: { type: Schema.Types.ObjectId, ref: 'User' }, // createdBy — audit trail
  totalAmount: { type: Number, required: true },
  currency: { type: String, default: 'CAD' },
  status: { type: String, default: 'pending' },
  paidAt: Date,
  dueDate: Date, // monthly accounts: the statement's due date
  statement: { type: Schema.Types.ObjectId, ref: 'Statement' }, // monthly statement it was billed on
  items: [invoiceItemSchema],
}, { timestamps: { createdAt: 'issuedAt', updatedAt: false } });

module.exports = mongoose.model('Invoice', invoiceSchema);
