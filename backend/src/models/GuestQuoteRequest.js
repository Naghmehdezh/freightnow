const mongoose = require('mongoose');
const { Schema } = mongoose;

// A quote request from a visitor without an account ("Continue as guest" on the home page).
// IFF staff contact the person directly and price the shipment by hand.
const guestQuoteRequestSchema = new Schema({
  requestNumber: { type: String, required: true, unique: true },
  // Customer information
  name: { type: String, required: true },
  company: String,
  email: { type: String, required: true },
  phone: { type: String, required: true },
  // Shipping information
  origin: { type: String, required: true },
  originType: { type: String, enum: ['door', 'terminal'], default: 'door' }, // door or terminal/port
  destination: { type: String, required: true },
  destinationType: { type: String, enum: ['door', 'terminal'], default: 'door' },
  mode: { type: String, enum: ['air', 'ocean', 'land'], required: true },
  volume: { type: String, enum: ['lcl', 'fcl', 'ltl', 'ftl'] }, // ocean: LCL/FCL; land: LTL/FTL
  // Optional shipment details: one entry per group of identical items.
  items: [{
    _id: false,
    length: Number, width: Number, height: Number, dimUnit: { type: String, enum: ['cm', 'in'] },
    weight: Number, weightUnit: { type: String, enum: ['kg', 'lb'] }, // weight of ONE item
    quantity: Number,
  }],
  termsOfSale: { type: String, enum: ['unknown', 'exw', 'fob', 'cif', 'cfr', 'dap', 'ddp', 'other'], default: 'unknown' },
  hazardous: { type: Boolean, default: false },
  notes: String,
  source: String, // e.g. 'home' — where the request started
  // Staff handling: new → contacted → quoted (price sent) → closed, or declined.
  status: { type: String, enum: ['new', 'contacted', 'quoted', 'declined', 'closed'], default: 'new' },
  // Price sent to the customer (kept for tracking; re-pricing overwrites it and is logged).
  quotedRate: Number,
  quotedCurrency: { type: String, enum: ['CAD', 'USD'] },
  carrierCost: Number,
  carrierName: String, // carrier IFF will use (internal)
  serviceName: String, // what the customer is told, e.g. "Ocean LCL — port to door"
  transitDays: Number,
  validUntil: Date,
  customerNote: String, // sent to the customer with the price or the decline
  quotedAt: Date,
  quotedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  declinedAt: Date,
  staffNote: String,
  handledBy: { type: Schema.Types.ObjectId, ref: 'User' },
  handledAt: Date,
}, { timestamps: { createdAt: 'submittedAt', updatedAt: 'updatedAt' } });

module.exports = mongoose.model('GuestQuoteRequest', guestQuoteRequestSchema);
