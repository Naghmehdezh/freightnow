const mongoose = require('mongoose');
const { Schema } = mongoose;

const bookingSchema = new Schema({
  bookingNumber: { type: String, required: true, unique: true },
  quote: { type: Schema.Types.ObjectId, ref: 'Quote', required: true, unique: true },
  quoteRate: { type: Schema.Types.ObjectId, ref: 'QuoteRate', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  company: { type: Schema.Types.ObjectId, ref: 'Company' }, // snapshot at booking time
  carrierId: { type: String, required: true },
  carrierName: { type: String, required: true },
  serviceName: { type: String, required: true },
  costRate: { type: Number, required: true },
  sellRate: { type: Number, required: true },
  currency: { type: String, default: 'CAD' },
  customerReference: String,
  paymentStatus: { type: String, default: 'not_required' }, // paid | invoiced | awaiting_payment | not_required
  status: { type: String, default: 'confirmed' }, // confirmed | awaiting_payment | cancelled
  // What the customer pays, in the currency they chose (CAD or USD), at the quote's locked
  // exchange rate. sellRate/costRate/currency stay in the carrier's currency (for margin).
  chargeCurrency: { type: String, enum: ['CAD', 'USD'] },
  chargeAmount: Number,
  fxRate: Number, // USD->CAD used
  // How it was paid: card (form), qb_link (QuickBooks invoice "Pay now" link), account (monthly), credit.
  paymentMethod: { type: String, enum: ['card', 'qb_link', 'account', 'credit'] },
  // "Pay with QuickBooks link": the booking is reserved until the invoice is paid (by payBy), then
  // the carrier is booked with the details from the booking form kept in pendingInput.
  qbInvoiceId: String,
  qbInvoiceLink: String,
  payBy: Date,
  pendingInput: Schema.Types.Mixed,
  pickupConfirmationNumber: String,
  measurementsConfirmedAt: Date, // customer confirmed weights/dimensions + accepted price adjustments
  pickupConfirmedAt: Date,
  cancelledAt: Date,

  // IFF price overrides made after booking. sellRate always holds the current agreed price;
  // originalSellRate keeps what the customer booked at. balanceAdjustment is what's still owed
  // either way once a paid booking is repriced: negative = credit owed to the customer,
  // positive = extra to collect. Settling it (refund / extra charge) is a manual step for now —
  // there's no automatic QuickBooks refund.
  originalSellRate: Number,
  balanceAdjustment: { type: Number, default: 0 },
  priceAdjustments: [{
    from: Number,
    to: Number,
    reason: String,
    note: String,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: Date,
  }],
}, { timestamps: { createdAt: 'bookedAt', updatedAt: 'updatedAt' } });

module.exports = mongoose.model('Booking', bookingSchema);
