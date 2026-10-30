const mongoose = require('mongoose');
const { Schema } = mongoose;

const spotRateRequestSchema = new Schema({
  requestNumber: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  shipmentType: { type: String, required: true },
  airService: { type: String, enum: ['pickup', 'dropoff'] }, // air: IFF picks up, or customer drops off
  originStreet: String,
  originCity: String,
  originProvince: String,
  originPostal: String,
  originCountry: { type: String, required: true },
  destCity: String,
  destProvince: String,
  destPostal: String,
  destCountry: { type: String, required: true },
  originPort: String,
  destPort: String,
  oceanType: String,
  weight: Number,
  weightUnit: { type: String, enum: ['lb', 'kg'], default: 'lb' },
  pieces: Number,
  skids: Number, // FTL / PTL
  dimensions: String, // legacy free-text dimensions
  // Air / ocean LCL: one entry per group of identical pieces. Volume weight in kg:
  // L×W×H / 6000 (cm) or / 366 (in), per piece.
  packages: [{
    _id: false, pieces: Number, length: Number, width: Number, height: Number,
    unit: { type: String, enum: ['cm', 'in'] }, volumeWeightKg: Number,
  }],
  volumeWeightKg: Number,
  chargeableWeightKg: Number, // the greater of actual and volume weight
  pickupDate: String,
  commodity: String,
  declaredValue: Number,
  specialNotes: String,
  // pending → quoted (IFF priced it; customer can book) → booked, or declined.
  // "expired" / "booked" are also derived on read from the linked quote.
  status: { type: String, enum: ['pending', 'quoted', 'declined', 'booked'], default: 'pending' },
  // Set when IFF staff price the request — creates a normal Quote + QuoteRate the customer books.
  quotedRate: Number,
  quotedCurrency: { type: String, enum: ['CAD', 'USD'] },
  carrierCost: Number,
  carrierName: String, // the carrier IFF will use (internal only)
  serviceName: String,
  transitDays: Number,
  validUntil: Date,
  customerNote: String, // shown to the customer with the price / decline
  staffNote: String, // internal only
  quotedAt: Date,
  quotedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
  quoteRate: { type: Schema.Types.ObjectId, ref: 'QuoteRate' },
  declinedAt: Date,
}, { timestamps: { createdAt: 'submittedAt', updatedAt: 'updatedAt' } });

module.exports = mongoose.model('SpotRateRequest', spotRateRequestSchema);
