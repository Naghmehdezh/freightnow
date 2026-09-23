const mongoose = require('mongoose');
const { Schema } = mongoose;

// The full pricing policy — cost bands, scope/density/multi-piece adjusters, packaging
// floors, the dim-weight divisor, and the USD->CAD rate — versioned as ONE document rather
// than per-band rows. Publishing a change retires the old version (active: false) and inserts
// a new one; nothing is ever overwritten, so a historical QuoteRate's `rulesVersion` stays
// reproducible. Ported from the standalone "Pricing Engine" reference (Postgres/Supabase) —
// see Pricing Engine/files/HANDOVER.md for the original design rationale.
const bandSchema = new Schema({
  max: { type: Number, required: true }, // upper cost ceiling for this band (ascending across the array)
  mk: { type: Number, required: true },  // markup percentage for costs up to `max`
}, { _id: false });

const pricingRuleSetSchema = new Schema({
  version: { type: Number, required: true }, // monotonic, set at publish time

  bands: {
    type: [bandSchema],
    required: true,
    validate: {
      validator: (arr) => arr.length > 0 && arr.every((b, i) => i === 0 || b.max > arr[i - 1].max),
      message: 'bands must be non-empty and strictly ascending by max',
    },
  },

  adjusters: {
    xb: { type: Number, required: true },          // cross-border (CA<->US) — percentage points added
    intl: { type: Number, required: true },         // international (outside CA/US) — percentage points added
    low_density: { type: Number, required: true },  // density < 6 pcf — percentage points added
    multi: { type: Number, required: true },        // 4+ pieces — percentage points added
  },

  floors: {
    Envelope: { type: Number, required: true },
    Package: { type: Number, required: true },
    Skid: { type: Number, required: true },
    LCL: { type: Number, required: true },
    min_gp: { type: Number, required: true }, // minimum gross profit over cost, regardless of packaging floor
    round: { type: Number, required: true },  // final sell price rounds UP to this increment
  },

  dim_divisor: { type: Number, required: true }, // courier volumetric-weight divisor (cubic inches / divisor = lb)
  usdToCadRate: { type: Number, required: true }, // folded in here rather than a separate settings collection

  active: { type: Boolean, default: false },
  note: String,
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'createdAt', updatedAt: false } });

// Mirrors the source system's Postgres partial unique index — MongoDB itself enforces
// "exactly one active version at a time" rather than relying on application discipline.
pricingRuleSetSchema.index({ active: 1 }, { unique: true, partialFilterExpression: { active: true } });

module.exports = mongoose.model('PricingRuleSet', pricingRuleSetSchema);
