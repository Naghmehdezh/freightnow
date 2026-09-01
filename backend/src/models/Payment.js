const mongoose = require('mongoose');
const { Schema } = mongoose;

// One record per attempt to charge a card, including failures. No real QuickBooks integration
// yet — this is schema-only scaffolding, not wired into the booking flow.
const paymentSchema = new Schema({
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'CAD' },
  qbTransactionId: String,
  status: { type: String, enum: ['pending', 'succeeded', 'failed', 'refunded'], default: 'pending' },
  failureReason: String,
}, { timestamps: { createdAt: 'attemptedAt', updatedAt: false } });

module.exports = mongoose.model('Payment', paymentSchema);
