const mongoose = require('mongoose');
const { Schema } = mongoose;

const quoteSchema = new Schema({
  quoteNumber: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  shipmentType: { type: String, required: true },
  originCity: String,
  originProvince: String,
  originPostal: String, // optional: spot-rate quotes (air/ocean) may only have a port
  originCountry: { type: String, required: true },
  destCity: String,
  destProvince: String,
  destPostal: String, // optional: spot-rate quotes (air/ocean) may only have a port
  destCountry: { type: String, required: true },
  weight: { type: Number, required: true },
  pieces: { type: Number, default: 1 },
  dimL: Number,
  dimW: Number,
  dimH: Number,
  // LTL: groups of identical pieces — dimensions (in), weight per piece (lb), freight class.
  lineItems: [{ _id: false, pieces: Number, length: Number, width: Number, height: Number, weight: Number, freightClass: String }],
  freightClass: String,
  currency: { type: String, default: 'CAD' },
  pickupDate: String,
  pickupReadyTime: String, // "HH:MM" — pickup window chosen with the date
  pickupCloseTime: String,
  declaredValue: Number,
  commodity: String,
  accessorials: String,
  // Option details chosen with the accessorials — needed again when the quote is booked.
  options: {
    fedexPackaging: String,
    fedexOneRate: Boolean,
    dgType: String, // ACCESSIBLE | INACCESSIBLE | SMALL_QUANTITY_EXCEPTION | BATTERY
    battery: { material: String, packing: String },
    homeDeliveryDate: String,
    limitedAccessType: String, // LTL limited access: type of site (Estes prices it by site type)
  },
  expiresAt: { type: Date, required: true },
  status: { type: String, default: 'active' },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

module.exports = mongoose.model('Quote', quoteSchema);
