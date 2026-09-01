const mongoose = require('mongoose');
const { Schema } = mongoose;

// Embedded, not a separate collection — the client's product guide lists notification
// preferences as a field under Users, not as one of its 17 named collections.
const notificationPreferenceSchema = new Schema({
  shipmentBooked: { type: Boolean, default: true },
  outForDelivery: { type: Boolean, default: true },
  delivered: { type: Boolean, default: true },
  exceptionsDelays: { type: Boolean, default: true },
  spotRateResponses: { type: Boolean, default: true },
  claimsUpdates: { type: Boolean, default: true },
  promotional: { type: Boolean, default: false },
}, { _id: false });

const userSchema = new Schema({
  email: { type: String, required: true, unique: true },
  auth0Id: { type: String, unique: true, sparse: true },
  passwordHash: { type: String },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phone: String,
  role: { type: String, enum: ['customer', 'company_admin', 'iff_staff', 'iff_admin'], default: 'customer' },
  company: { type: Schema.Types.ObjectId, ref: 'Company' },
  termsAcceptedAt: Date,
  termsAcceptedFromIp: String,
  fedexTermsAcceptedAt: Date,
  fedexTermsAcceptedFromIp: String,
  notifications: { type: notificationPreferenceSchema, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
