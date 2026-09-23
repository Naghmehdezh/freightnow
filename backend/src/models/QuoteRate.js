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

  // Snapshot of the pricing engine's output at quote time, so a historical price stays
  // reproducible even after the active PricingRuleSet changes later.
  rulesVersion: Number,
  markupPct: Number,
  grossMargin: Number,
  costCad: Number,
  sellCad: Number,
  fxRate: Number,
  chargeableWt: Number,
  densityPcf: Number,
  estClass: Number,
  dimGoverns: Boolean,
  flags: [String],
});

module.exports = mongoose.model('QuoteRate', quoteRateSchema);
