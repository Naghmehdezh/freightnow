const mongoose = require('mongoose');
const { Schema } = mongoose;

const companySchema = new Schema({
  name: { type: String, required: true },
  street: String,
  city: String,
  province: String,
  postalCode: String,
  country: { type: String, required: true },
  phone: String,
  taxNumber: String,
  shippingType: String,
  paymentTerms: { type: String, enum: ['card', 'monthly'], default: 'card' },
  // Monthly-terms accounts: how much they can have unpaid (CAD; USD bookings count at the pricing
  // rule set's USD->CAD rate) and how long they have to pay each monthly statement.
  creditLimit: { type: Number, default: 0 },
  qbCustomerId: String, // QuickBooks Online customer (created the first time an invoice link is made)
  statementTermsDays: { type: Number, default: 30 },
  // Store credit per currency (e.g. from a carrier undercharge), used automatically at booking.
  credit: {
    CAD: { type: Number, default: 0 },
    USD: { type: Number, default: 0 },
  },
  // Overdue adjustment balance: no new bookings until it's paid.
  accountHold: {
    active: { type: Boolean, default: false },
    reason: String,
    since: Date,
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
