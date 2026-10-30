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
  // Currency the carrier quoted in. baseRate (carrier cost), engineRate and displayRate (price)
  // are all in this currency — never converted. Quotes can mix CAD and USD rates.
  currency: { type: String, enum: ['CAD', 'USD'], default: 'CAD' },
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

  // Manual price adjustment by IFF (discount / competitive match / correction). displayRate
  // always holds the price the customer sees and books; engineRate keeps what the pricing
  // engine originally produced, so the adjustment stays visible and calibration can compare
  // achieved markup against the rules.
  engineRate: Number,
  // The carrier's charge for each selected option (already included in baseRate / displayRate).
  accessorialCharges: [{ _id: false, code: String, label: String, amount: Number }],
  // Selected options this carrier couldn't include in its price (the rate is still bookable).
  notIncludedOptions: [String],
  notIncludedMessage: String,
  adjustedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  adjustedAt: Date,
  adjustmentReason: {
    type: String,
    enum: ['discount', 'competitive', 'contract', 'oneoff', 'correction', 'other'],
  },
  adjustmentNote: String,
});

module.exports = mongoose.model('QuoteRate', quoteRateSchema);
