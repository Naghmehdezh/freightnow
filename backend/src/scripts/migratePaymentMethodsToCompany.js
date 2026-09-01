/**
 * Migration: Link existing PaymentMethod records to their user's company.
 * Safe to run multiple times (idempotent — skips records that already have a company).
 *
 * Usage: node backend/src/scripts/migratePaymentMethodsToCompany.js
 */
const mongoose = require('mongoose');
const { mongodb } = require('../config/env');

const PaymentMethod = require('../models/PaymentMethod');
const User = require('../models/User');

async function migrate() {
  await mongoose.connect(mongodb.uri);
  console.log('[MIGRATION] Connected to MongoDB');

  const methods = await PaymentMethod.find({ company: { $exists: false } });
  console.log(`[MIGRATION] Found ${methods.length} payment methods without a company`);

  let updated = 0;
  let orphaned = 0;

  for (const pm of methods) {
    if (!pm.user) {
      console.warn(`[MIGRATION] PaymentMethod ${pm._id} has no user — skipping`);
      orphaned++;
      continue;
    }

    const user = await User.findById(pm.user);
    if (!user) {
      console.warn(`[MIGRATION] PaymentMethod ${pm._id} references user ${pm.user} which does not exist — skipping`);
      orphaned++;
      continue;
    }

    if (!user.company) {
      console.warn(`[MIGRATION] PaymentMethod ${pm._id} belongs to user ${user.email} who has no company — skipping`);
      orphaned++;
      continue;
    }

    pm.company = user.company;
    await pm.save();
    updated++;
  }

  console.log(`[MIGRATION] Done. Updated: ${updated}, Orphaned/skipped: ${orphaned}`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('[MIGRATION] Failed:', err);
  process.exit(1);
});
