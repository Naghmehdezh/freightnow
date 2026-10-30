const mongoose = require('mongoose');
const { Schema } = mongoose;

const shipmentSchema = new Schema({
  trackingNumber: { type: String, required: true, unique: true }, // IFF internal (IFF-2026-00001)
  carrierTrackingNumber: String, // real carrier tracking (e.g. FedEx 794860006524)
  carrierConfirmationNumber: String, // carrier-specific ID (e.g. CSA orderId for tracking)
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  company: { type: Schema.Types.ObjectId, ref: 'Company' }, // denormalized snapshot
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  carrierId: { type: String, required: true },
  carrierName: { type: String, required: true },
  serviceName: { type: String, required: true },
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
  pieces: { type: Number, required: true },
  dimL: Number,
  dimW: Number,
  dimH: Number,
  freightClass: String,
  currency: { type: String, default: 'CAD' },
  declaredValue: Number,
  commodity: String,
  accessorials: String,
  // Collected when booking (the quote only has city/postal code).
  shipperContact: { name: String, company: String, phone: String },
  originStreet: [String],
  recipientContact: { name: String, company: String, phone: String, email: String },
  destStreet: [String],
  holdAtLocation: { locationId: String, locationType: String, name: String, address: Schema.Types.Mixed },
  dangerousGoods: {
    unNumber: String, properShippingName: String, hazardClass: String, packingGroup: String,
    quantity: Number, units: String, emergencyPhone: String,
  },
  // Set when the carrier booking must be finished by IFF staff (e.g. fully regulated dangerous goods).
  manualCarrierBooking: { required: Boolean, reason: String },
  labelBase64: String, // base64-encoded shipping label from carrier
  labelDocType: String, // PDF, PNG, ZPLII
  status: { type: String, default: 'pending' }, // pending → in_transit → delivered (from carrier tracking)
  estimatedDelivery: String,
  actualDelivery: String,
  lastTrackedAt: Date, // last time the carrier was asked for this shipment's status
  // Pickup with the carrier: 'scheduled' (carrier confirmed it) or 'to_arrange' (IFF must book it).
  pickupStatus: { type: String, enum: ['scheduled', 'to_arrange'] },
}, { timestamps: { createdAt: 'bookedAt', updatedAt: 'updatedAt' } });

module.exports = mongoose.model('Shipment', shipmentSchema);
