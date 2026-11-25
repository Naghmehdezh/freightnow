const mongoose = require('mongoose');
const { Schema } = mongoose;

// Monthly statement for a monthly-terms account: every unpaid invoice from the period (bookings and
// price adjustments), less any store credit, due Net N days. Paying it frees the account's credit.
const statementLineSchema = new Schema({
  _id: false,
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  invoiceNumber: String,
  bookingNumber: String,
  description: String,
  issuedAt: Date,
  amount: Number,
  currency: { type: String, enum: ['CAD', 'USD'], default: 'CAD' },
});

const paymentSchema = new Schema({
  _id: false,
  amount: { type: Number, required: true }, // CAD
  method: { type: String, enum: ['cheque', 'eft', 'card', 'other'], default: 'eft' },
  reference: String,
  receivedAt: { type: Date, default: Date.now },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
});

const statementSchema = new Schema({
  statementNumber: { type: String, required: true, unique: true }, // STM-202611-0001
  company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  period: { type: String, required: true }, // '2026-11'
  periodStart: Date,
  periodEnd: Date,
  lines: [statementLineSchema],
  totals: { CAD: { type: Number, default: 0 }, USD: { type: Number, default: 0 } },
  fxRate: Number, // USD->CAD used for totalCad
  totalCad: Number,
  creditApplied: { type: Number, default: 0 }, // store credit (CAD) taken off this statement
  amountDue: Number, // CAD: totalCad - creditApplied
  dueDate: Date,
  status: { type: String, enum: ['open', 'partially_paid', 'paid', 'void'], default: 'open' },
  payments: [paymentSchema],
  paidAmount: { type: Number, default: 0 },
  paidAt: Date,
}, { timestamps: { createdAt: 'issuedAt', updatedAt: 'updatedAt' } });

statementSchema.index({ company: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('Statement', statementSchema);
