const mongoose = require('mongoose');
const PricingRuleSet = require('../models/PricingRuleSet');
const activityLogService = require('./activityLog.service');
const { NotFoundError, ValidationError } = require('../utils/errors');

async function getActiveRuleSet() {
  const ruleSet = await PricingRuleSet.findOne({ active: true });
  if (!ruleSet) throw new NotFoundError('Active pricing rule set');
  return ruleSet;
}

// Publishes a whole new rule-set version and retires the old one — never mutated in place, so
// a historical quote's `rulesVersion` stays reproducible. Bands must be present and strictly
// ascending by `max` (the model schema also enforces this; re-checked here so a bad publish
// fails with a clear message before anything is written).
async function publishRuleSet(actingUserId, { bands, adjusters, floors, dim_divisor, usdToCadRate, note }) {
  if (!Array.isArray(bands) || bands.length === 0) {
    throw new ValidationError('bands must be a non-empty array');
  }
  for (let i = 0; i < bands.length; i++) {
    if (bands[i].max == null || bands[i].mk == null) {
      throw new ValidationError('every band needs a max and an mk');
    }
    if (i > 0 && bands[i].max <= bands[i - 1].max) {
      throw new ValidationError(`band ceilings must increase: ${bands[i].max} came after ${bands[i - 1].max}`);
    }
  }

  const session = await mongoose.startSession();
  let created;
  try {
    await session.withTransaction(async () => {
      const current = await PricingRuleSet.findOne({ active: true }).session(session);
      if (current) {
        await PricingRuleSet.updateOne({ _id: current._id }, { active: false }, { session });
      }
      const nextVersion = (current?.version ?? 0) + 1;
      [created] = await PricingRuleSet.create([{
        version: nextVersion,
        bands,
        adjusters,
        floors,
        dim_divisor,
        usdToCadRate,
        active: true,
        note,
        createdBy: actingUserId,
      }], { session });

      activityLogService.logActivity(actingUserId, null, 'pricing_rules_changed', {
        fromVersion: current?.version ?? null,
        toVersion: nextVersion,
        note,
      });
    });
  } finally {
    session.endSession();
  }

  return created;
}

module.exports = { getActiveRuleSet, publishRuleSet };
