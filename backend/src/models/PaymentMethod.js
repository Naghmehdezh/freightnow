const mongoose = require('mongoose');
const { Schema } = mongoose;

const paymentMethodSchema = new Schema({
  company: { type: Schema.Types.ObjectId, ref: 'Company' },
  user: { type: Schema.Types.ObjectId, ref: 'User' }, // addedBy — audit trail
  type: { type: String, required: true },
  last4: { type: String, required: true },
  expiryMonth: { type: Number, required: true },
  expiryYear: { type: Number, required: true },
  isDefault: { type: Boolean, default: false },
  qbCardToken: String, // QuickBooks Payments tokenized card ID
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

module.exports = mongoose.model('PaymentMethod', paymentMethodSchema);
