#!/usr/bin/env node
/**
 * Syncs carrier coverage from Carrier_Mapping.md (repo root) into the Carrier collection.
 *
 * The mapping table says which shipment types (Packages / Envelopes / LTL) and lanes
 * (International / Domestic Canada / Domestic US / Cross Border) each carrier handles.
 * rate.service.js only asks carriers whose coverage matches the shipment, so editing the
 * table and re-running this script changes routing without a code change.
 *
 * Rows marked with * (e.g. "FedEx Freight*", "UPS*") are planned carriers with no adapter yet
 * and are skipped. Adapters that have no row get empty coverage, so they're never queried.
 *
 * Usage:  npm run carriers:sync      (or: node src/scripts/syncCarrierMapping.js)
 */

const fs = require('fs');
const path = require('path');

const MAPPING_FILE = path.resolve(__dirname, '../../../Carrier_Mapping.md');

// "Company" column → adapter id (backend/src/carriers/<id>.adapter.js).
const COMPANY_TO_CARRIER = {
  'xpo': 'xpo',
  'estes': 'estes',
  'polaris transport': 'polaris',
  'day & ross': 'dayross',
  'dhl': 'dhl',
  'csa transport': 'csa',
  'fedex': 'fedex',
  'manitoulin': 'manitoulin',
  'manitoulin transport': 'manitoulin',
};

const COLUMN_TO_TYPE = { packages: 'parcel', envelopes: 'envelope', ltl: 'ltl' };
const COLUMN_TO_LANE = {
  'international': 'international',
  'domestic canada': 'domestic_ca',
  'domestic us': 'domestic_us',
  'cross border (canada <-> us)': 'cross_border',
};

function parseMapping(markdown) {
  const rows = markdown.split('\n')
    .filter(l => l.trim().startsWith('|'))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()));
  const header = rows.find(r => r.some(c => c.toLowerCase() === 'company'));
  if (!header) throw new Error('Carrier_Mapping.md: no header row with a "Company" column');
  const col = name => header.findIndex(c => c.toLowerCase() === name);
  const companyIdx = col('company');

  const mapped = {};
  const skipped = [];
  for (const row of rows) {
    const company = row[companyIdx];
    if (!company || row === header || /^-+$/.test(company)) continue;
    if (company.endsWith('*')) { skipped.push(`${company} (planned — no adapter yet)`); continue; }
    const carrierId = COMPANY_TO_CARRIER[company.toLowerCase()];
    if (!carrierId) { skipped.push(`${company} (no matching adapter)`); continue; }

    const ticked = name => /^x$/i.test(row[col(name)] || '');
    mapped[carrierId] = {
      company,
      shipmentTypes: Object.keys(COLUMN_TO_TYPE).filter(ticked).map(c => COLUMN_TO_TYPE[c]),
      lanes: Object.keys(COLUMN_TO_LANE).filter(ticked).map(c => COLUMN_TO_LANE[c]),
    };
  }
  return { mapped, skipped };
}

// Applies the mapping to the Carrier collection. Used by this script and by seed.js.
async function syncCarrierMapping({ log = console.log } = {}) {
  const Carrier = require('../models/Carrier');
  const { carriers } = require('../carriers');
  const { mapped, skipped } = parseMapping(fs.readFileSync(MAPPING_FILE, 'utf8'));

  for (const carrierId of Object.keys(carriers)) {
    const m = mapped[carrierId];
    const update = m ? { shipmentTypes: m.shipmentTypes, lanes: m.lanes } : { shipmentTypes: [], lanes: [] };
    await Carrier.updateOne({ carrierId }, { $set: update });
    log(`  ${carrierId.padEnd(11)} ${m ? `${update.shipmentTypes.join(', ') || '—'}  |  ${update.lanes.join(', ') || '—'}` : 'not in Carrier_Mapping.md — will not be queried'}`);
  }
  for (const s of skipped) log(`  skipped: ${s}`);
}

module.exports = { parseMapping, syncCarrierMapping };

if (require.main === module) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
  const { connectDB, mongoose } = require('../config/database');
  (async () => {
    await connectDB();
    console.log(`Syncing carrier coverage from ${MAPPING_FILE}`);
    await syncCarrierMapping();
    await mongoose.disconnect();
  })().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
}
