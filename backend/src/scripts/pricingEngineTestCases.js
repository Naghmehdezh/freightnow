#!/usr/bin/env node
/**
 * Pricing Engine — Manual Verification Test Cases
 *
 * Exercises the ported pricing engine (backend/src/services/pricingEngine.service.js) and the
 * admin rule-set publish flow (backend/src/services/pricingRules.service.js) directly against
 * the database — no HTTP server, no auth needed, so this works even when the Express server
 * can't boot locally (e.g. missing Auth0 env vars).
 *
 * Requires the database to be seeded first: npm run db:seed
 *
 * Run:  node backend/src/scripts/pricingEngineTestCases.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { connectDB, mongoose } = require('../config/database');
const rateService = require('../services/rate.service');
const pricingRulesService = require('../services/pricingRules.service');
const User = require('../models/User');
const PricingRuleSet = require('../models/PricingRuleSet');

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: expected ${expected}, got ${actual}`);
  if (ok) pass++; else fail++;
}

function checkFlag(label, flags, substring) {
  const ok = flags.some(f => f.includes(substring));
  console.log(`  ${ok ? '✓' : '✗'} ${label} — looking for "${substring}"`);
  if (ok) pass++; else fail++;
}

async function main() {
  await connectDB();
  const user = await User.findOne({ email: 'john@acmecorp.com' });
  if (!user) {
    console.error('Seed data not found — run `npm run db:seed` first.');
    process.exit(1);
  }

  console.log('=== Test 1: Domestic LTL, hand-computable ===');
  console.log('500 lb, 2 pieces, 48x40x48 in, cost band should land in the $500-$1000 tier');
  const r1 = await rateService.getSingleCarrierRate('fedex', {
    shipmentType: 'ltl',
    origin: { city: 'Toronto', postalCode: 'M5V3A8', country: 'CA' },
    destination: { city: 'Vancouver', postalCode: 'V6B2W2', country: 'CA' },
    weight: 500, pieces: 2, dimensions: { length: 48, width: 40, height: 48 },
    freightClass: '70', currency: 'CAD',
  });
  console.log('  result:', JSON.stringify(r1[0]));
  checkFlag('low-density adjuster applied (density ~4.7 pcf)', r1[0].flags, 'light and bulky');
  checkFlag('near freight-class boundary flag present', r1[0].flags, 'class boundary');

  console.log('\n=== Test 2: Cross-border parcel, 4 pieces — multi-piece + xb adjusters ===');
  const r2 = await rateService.getSingleCarrierRate('fedex', {
    shipmentType: 'parcel',
    origin: { city: 'Toronto', postalCode: 'M5V3A8', country: 'CA' },
    destination: { city: 'New York', postalCode: '10001', country: 'US' },
    weight: 40, pieces: 4, dimensions: { length: 12, width: 9, height: 1 },
    currency: 'CAD',
  });
  console.log('  result:', JSON.stringify(r2[0]));
  checkFlag('multi-piece flag present (4 pieces)', r2[0].flags, 'Multi-piece');
  checkFlag('cross-border customs flag present', r2[0].flags, 'Cross-border');

  console.log('\n=== Test 3: Envelope with no dimensions — should hit the floor ===');
  const r3 = await rateService.getSingleCarrierRate('fedex', {
    shipmentType: 'envelope',
    origin: { city: 'Toronto', postalCode: 'M5V3A8', country: 'CA' },
    destination: { city: 'Ottawa', postalCode: 'K1A0A9', country: 'CA' },
    weight: 0.5, pieces: 1, currency: 'CAD',
  });
  console.log('  result:', JSON.stringify(r3[0]));
  checkFlag('no-dimensions flag present', r3[0].flags, 'No dimensions entered');
  checkFlag('floor flag present', r3[0].flags, 'Floored');
  check('floored price matches the seeded Envelope floor ($105)', r3[0].rate, 105);

  console.log('\n=== Test 4: Admin publish — version bump, old version retired ===');
  const admin = await User.findOne({ email: 'admin@iffcargo.com' });
  const before = await pricingRulesService.getActiveRuleSet();
  const republished = await pricingRulesService.publishRuleSet(admin._id.toString(), {
    bands: before.bands.toObject ? before.bands.toObject() : before.bands,
    adjusters: before.adjusters.toObject ? before.adjusters.toObject() : before.adjusters,
    floors: before.floors.toObject ? before.floors.toObject() : before.floors,
    dim_divisor: before.dim_divisor,
    usdToCadRate: before.usdToCadRate,
    note: 'test run — identical values, just proving the version bumps',
  });
  check('version incremented', republished.version, before.version + 1);
  check('exactly one active rule set exists', await PricingRuleSet.countDocuments({ active: true }), 1);
  const oldDoc = await PricingRuleSet.findById(before._id);
  check('previous version is now inactive', oldDoc.active, false);

  // Leave the rule set exactly as it was before this script ran (undo the extra version).
  await PricingRuleSet.deleteOne({ _id: republished._id });
  await PricingRuleSet.updateOne({ _id: before._id }, { active: true });

  console.log(`\n${pass} passed, ${fail} failed.`);
  await mongoose.disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
