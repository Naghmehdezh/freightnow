#!/usr/bin/env node
/**
 * Carrier rate check — asks every carrier for a real rate on a standard test shipment, for each
 * shipment type and lane it covers (Carrier collection / Carrier_Mapping.md), and reports what
 * came back. Read-only: nothing is booked or saved. Prices are the carrier's own (no markup).
 *
 * Usage:  npm run carriers:check                 (all carriers)
 *         npm run carriers:check -- xpo estes    (only these)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const Carrier = require('../models/Carrier');
const { carriers } = require('../carriers');
const { normalizeLineItems } = require('../utils/lineItems');
const { addBusinessDays, formatDate } = require('../utils/dateHelpers');

const PLACES = {
  toronto: { city: 'Mississauga', province: 'ON', postalCode: 'L5T 2N7', country: 'CA' },
  ottawa: { city: 'Ottawa', province: 'ON', postalCode: 'K1P 1J1', country: 'CA' },
  richmond: { city: 'Richmond', province: 'VA', postalCode: '23230', country: 'US' },
  atlanta: { city: 'Atlanta', province: 'GA', postalCode: '30303', country: 'US' },
  buffalo: { city: 'Buffalo', province: 'NY', postalCode: '14202', country: 'US' },
  london: { city: 'London', postalCode: 'SW1A1AA', country: 'GB' },
};
const LANES = {
  domestic_ca: ['toronto', 'ottawa'],
  domestic_us: ['richmond', 'atlanta'],
  cross_border: ['toronto', 'buffalo'],
  international: ['toronto', 'london'],
};
const SHIPMENTS = {
  envelope: { weight: 1, pieces: 1, dimensions: { length: 12, width: 9, height: 1 } },
  parcel: { weight: 5, pieces: 1, dimensions: { length: 12, width: 10, height: 8 } },
  ltl: { lineItems: [{ pieces: 1, length: 48, width: 40, height: 48, weight: 800 }] },
};
const TIMEOUT_MS = 60000;

const pickupDate = formatDate(addBusinessDays(new Date(), 2));

function withTimeout(promise) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS))]);
}

async function check(adapter, shipmentType, lane) {
  const [from, to] = LANES[lane];
  const params = { shipmentType, origin: { ...PLACES[from] }, destination: { ...PLACES[to] }, pickupDate, accessorials: [], ...JSON.parse(JSON.stringify(SHIPMENTS[shipmentType])) };
  if (shipmentType === 'ltl') normalizeLineItems(params);
  if (!adapter.canQuote(params)) return { status: 'skip', note: 'adapter does not quote this lane' };
  if (!adapter.isLive) return { status: 'skip', note: 'no live credentials in .env' };

  const started = Date.now();
  // Call the live method directly so the real error is visible (getRates() hides errors).
  const quote = adapter._getLiveRates ? adapter._getLiveRates(params) : adapter.getRates(params);
  try {
    const rates = await withTimeout(quote);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (!rates.length) return { status: 'none', note: `no rates returned (${secs}s)` };
    const cheapest = [...rates].sort((a, b) => a.rate - b.rate)[0];
    return { status: 'ok', note: `${rates.length} rate(s), from ${cheapest.rate.toFixed(2)} ${cheapest.currency || 'CAD'} — ${cheapest.serviceName} (${secs}s)` };
  } catch (err) {
    const detail = (err.body?.errors || []).map(e => e.code || e.description || e.message).filter(Boolean).join(', ')
      || err.body?.error?.message || err.body?.message || err.message;
    return { status: 'error', note: String(detail).replace(/\s+/g, ' ').slice(0, 160) };
  }
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const only = process.argv.slice(2);
  const records = await Carrier.find(only.length ? { carrierId: { $in: only } } : {}).sort({ carrierId: 1 }).lean();
  const ICON = { ok: '✅', none: '⚠️ ', error: '❌', skip: '➖' };
  const summary = { ok: 0, none: 0, error: 0, skip: 0 };

  console.log(`Carrier rate check — pickup ${pickupDate}\n`);
  for (const rec of records) {
    const adapter = carriers[rec.carrierId];
    if (!adapter) { console.log(`${rec.carrierId}: no adapter in code`); continue; }
    if (!rec.enabled) { console.log(`➖ ${adapter.name}: disabled in the Carrier collection\n`); continue; }
    const combos = (rec.shipmentTypes || []).filter(t => SHIPMENTS[t]).flatMap(t => (rec.lanes || []).filter(l => LANES[l]).map(l => [t, l]));
    if (!combos.length) { console.log(`➖ ${adapter.name}: not mapped to any shipment type / lane (Carrier_Mapping.md)\n`); continue; }
    console.log(`${adapter.name}${adapter.isLive ? '' : ' (not live)'}`);
    for (const [type, lane] of combos) {
      const r = await check(adapter, type, lane);
      summary[r.status]++;
      console.log(`  ${ICON[r.status]} ${type.padEnd(8)} ${lane.padEnd(13)} ${r.note}`);
    }
    console.log('');
  }
  console.log(`Summary: ${summary.ok} returned rates · ${summary.none} returned none · ${summary.error} errors · ${summary.skip} skipped`);
  await mongoose.disconnect();
  process.exit(0);
})().catch(async (err) => { console.error('FATAL', err.message); await mongoose.disconnect(); process.exit(1); });
