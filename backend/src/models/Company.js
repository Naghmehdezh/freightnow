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
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Company', companySchema);
