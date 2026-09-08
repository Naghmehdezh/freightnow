const mongoose = require('mongoose');
const { Schema } = mongoose;

// Kept as its own collection (not embedded in Quote) — the client's product guide names
// "Quote options" as one of its 17 collections.
const quoteRateSchema = new Schema({
  quote: { type: Schema.Types.ObjectId, ref: 'Quote', required: true },
  carrierId: { type: String, required: true },
  carrierName: { type: String, required: true },
  serviceName: { type: String, required: true },
  serviceCode: String, // carrier-specific service code (e.g. 'FEDEX_EXPRESS_SAVER')
  baseRate: { type: Number, required: true },
  displayRate: { type: Number, required: true },
  transitDays: { type: Number, required: true },
  estimatedDelivery: String,
  isLiveRate: { type: Boolean, default: false },
  isBestRate: { type: Boolean, default: false },
});

module.exports = mongoose.model('QuoteRate', quoteRateSchema);
