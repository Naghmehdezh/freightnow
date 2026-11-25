const mongoose = require('mongoose');
const { Schema } = mongoose;

// A price correction after booking: the carrier weighed/measured the freight (or found an
// extra service) and charged a different amount than quoted. The new carrier cost is priced by
// the same engine and rules version as the original quote, and the customer is charged — or
// credited — the difference.
const measurementSchema = new Schema({
  _id: false,
  weight: Number, // total lb
  pieces: Number,
  length: Number, width: Number, height: Number, // in
  freightClass: String,
}, { minimize: true });

const adjustmentSchema = new Schema({
  adjustmentNumber: { type: String, required: true, unique: true }, // ADJ-2026-0001
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  shipment: { type: Schema.Types.ObjectId, ref: 'Shipment' },
  company: { type: Schema.Types.ObjectId, ref: 'Company' },
  user: { type: Schema.Types.ObjectId, ref: 'User' }, // the customer who booked
  currency: { type: String, enum: ['CAD', 'USD'], default: 'CAD' },

  reason: { type: String, enum: ['weight', 'dimensions', 'freight_class', 'accessorial', 'other'], required: true },
  entered: measurementSchema, // what the customer entered on the quote
  measured: measurementSchema, // what the carrier found
  carrierReference: String, // carrier invoice / inspection / reweigh certificate number
  evidenceNote: String, // what the carrier reported (photos/certificates are kept by IFF staff)

  // Money. Prices come from the pricing engine (rules version below); the customer pays
  // newPrice - originalPrice (+ admin fee). Below the threshold IFF absorbs it; negative = credit.
  originalCost: Number,
  newCost: Number,
  originalPrice: Number,
  newPrice: Number,
  difference: Number,
  adminFee: { type: Number, default: 0 },
  amountDue: { type: Number, default: 0 }, // what the customer is asked to pay (0 when absorbed/credited)
  creditAmount: { type: Number, default: 0 }, // undercharge returned to the customer
  rulesVersion: Number,
  outcome: { type: String, enum: ['charge', 'absorbed', 'credit', 'refund'], required: true },

  // draft -> sent -> paid | disputed -> (sent | waived); absorbed / credited / refunded are final.
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'disputed', 'waived', 'absorbed', 'credited', 'refunded', 'cancelled'],
    default: 'draft',
  },
  dueDate: Date,
  sentAt: Date,
  paidAt: Date,
  paidWithCredit: { type: Number, default: 0 },
  qbTransactionId: String,
  disputeReason: String,
  disputedAt: Date,
  resolutionNote: String,
  staffNote: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

adjustmentSchema.index({ company: 1, status: 1 });
adjustmentSchema.index({ booking: 1 });

module.exports = mongoose.model('Adjustment', adjustmentSchema);
