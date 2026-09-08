const mongoose = require('mongoose');
const { Schema } = mongoose;

const quoteSchema = new Schema({
  quoteNumber: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  shipmentType: { type: String, required: true },
  originCity: String,
  originProvince: String,
  originPostal: { type: String, required: true },
  originCountry: { type: String, required: true },
  destCity: String,
  destProvince: String,
  destPostal: { type: String, required: true },
  destCountry: { type: String, required: true },
  weight: { type: Number, required: true },
  pieces: { type: Number, default: 1 },
  dimL: Number,
  dimW: Number,
  dimH: Number,
  freightClass: String,
  currency: { type: String, default: 'CAD' },
  pickupDate: String,
  declaredValue: Number,
  commodity: String,
  accessorials: String,
  expiresAt: { type: Date, required: true },
  status: { type: String, default: 'active' },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

module.exports = mongoose.model('Quote', quoteSchema);
