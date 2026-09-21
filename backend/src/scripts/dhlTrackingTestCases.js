#!/usr/bin/env node
/**
 * DHL Express Certification — Tracking Test Cases
 *
 * Runs all 7 tracking test cases against the DHL sandbox and saves
 * JSON request/response files for certification submission.
 *
 * Test cases (from certification spreadsheet Tab 3):
 *   1. Single track 9356579890 — last-checkpoint / all
 *   2. Single track 9356579890 — all-checkpoints / piece
 *   3. Single track 5980622970 — shipment-details-only / shipment
 *   4. Multi track JD014600011773791050,JD014600011800006571 — all-checkpoints / piece
 *   5. Multi track 5980623180,6781059250 — last-checkpoint / all
 *   6. Multi track JD014600011773791050,JD014600011800006571 — shipment-details-only / piece
 *   7. Multi track 7957673080,5980622970 — shipment-details-only / shipment
 *
 * Usage:
 *   node backend/src/scripts/dhlTrackingTestCases.js        # all 7
 *   node backend/src/scripts/dhlTrackingTestCases.js 3      # single case by number
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getBaseUrl, httpsGet } = require('../services/dhlApi.service');

const OUT_DIR = path.resolve(__dirname, '../../../dhl_test_output');

// ── Test cases from certification spreadsheet ─────────────────────
const TEST_CASES = [
  {
    id: 'Track_1',
    description: 'Single shipment — last-checkpoint / all',
    trackingNumbers: ['9356579890'],
    trackingView: 'last-checkpoint',
    levelOfDetail: 'all',
  },
  {
    id: 'Track_2',
    description: 'Single shipment — all-checkpoints / piece',
    trackingNumbers: ['9356579890'],
    trackingView: 'all-checkpoints',
    levelOfDetail: 'piece',
  },
  {
    id: 'Track_3',
    description: 'Single shipment — shipment-details-only / shipment',
    trackingNumbers: ['5980622970'],
    trackingView: 'shipment-details-only',
    levelOfDetail: 'shipment',
  },
  {
    id: 'Track_4',
    description: 'Multiple shipments — all-checkpoints / piece',
    trackingNumbers: ['JD014600011773791050', 'JD014600011800006571'],
    trackingView: 'all-checkpoints',
    levelOfDetail: 'piece',
  },
  {
    id: 'Track_5',
    description: 'Multiple shipments — last-checkpoint / all',
    trackingNumbers: ['5980623180', '6781059250'],
    trackingView: 'last-checkpoint',
    levelOfDetail: 'all',
  },
  {
    id: 'Track_6',
    description: 'Multiple shipments — all-checkpoints / piece (JD piece numbers)',
    trackingNumbers: ['JD014600011773791050', 'JD014600011800006571'],
    trackingView: 'all-checkpoints',
    levelOfDetail: 'piece',
  },
  {
    id: 'Track_7',
    description: 'Multiple shipments — shipment-details-only / shipment',
    trackingNumbers: ['7957673080', '5980622970'],
    trackingView: 'shipment-details-only',
    levelOfDetail: 'shipment',
  },
];

// ── Helpers ────────────────────────────────────────────────────────

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function saveJSON(filename, data) {
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  const kb = (Buffer.byteLength(JSON.stringify(data, null, 2)) / 1024).toFixed(1);
  console.log(`  ✓ Saved ${filename} (${kb} KB)`);
}

// ── Run a single tracking test case ───────────────────────────────

async function runTestCase(tc) {
  console.log(`\n━━━ ${tc.id}: ${tc.description} ━━━`);

  const numbers = tc.trackingNumbers.join(',');
  // JD-prefix numbers are piece tracking numbers (20+ chars);
  // shipmentTrackingNumber maxLength is 11, so use pieceTrackingNumber for those.
  const hasLongNumbers = tc.trackingNumbers.some(n => n.length > 11);
  const trackingParam = hasLongNumbers ? 'pieceTrackingNumber' : 'shipmentTrackingNumber';
  const params = new URLSearchParams({
    [trackingParam]: numbers,
    trackingView: tc.trackingView,
    levelOfDetail: tc.levelOfDetail,
  });

  const url = `${getBaseUrl()}/tracking?${params.toString()}`;

  // Save the "request" as URL + params (GET requests have no body)
  const requestInfo = {
    method: 'GET',
    url,
    params: {
      [trackingParam]: tc.trackingNumbers,
      trackingView: tc.trackingView,
      levelOfDetail: tc.levelOfDetail,
    },
  };

  console.log(`  Tracking: ${numbers}`);
  console.log(`  View: ${tc.trackingView}, Detail: ${tc.levelOfDetail}`);

  try {
    const response = await httpsGet(url);
    saveJSON(`${tc.id}_request.json`, requestInfo);
    saveJSON(`${tc.id}_response.json`, response);

    // Print summary
    const shipments = response.shipments || [];
    if (shipments.length) {
      for (const s of shipments) {
        const events = s.events || [];
        const latest = events[0];
        console.log(`  → ${s.id || 'N/A'}: ${latest?.description || latest?.status || 'no events'} (${events.length} event(s))`);
      }
    } else {
      console.log('  → Response received (check JSON for details)');
    }
    return true;
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
    saveJSON(`${tc.id}_request.json`, requestInfo);
    saveJSON(`${tc.id}_error.json`, {
      error: err.message,
      statusCode: err.statusCode || null,
      body: err.body || null,
    });
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('DHL Express — Tracking Certification Test Cases');
  console.log('='.repeat(55));
  console.log(`Base URL: ${getBaseUrl()}`);

  ensureOutDir();

  // Parse CLI arguments — optional filter by test case number
  const filter = process.argv[2];
  let cases = [...TEST_CASES];
  if (filter) {
    cases = cases.filter(tc => tc.id.includes(filter) || tc.description.toLowerCase().includes(filter.toLowerCase()));
    if (cases.length === 0) {
      console.error(`No test cases matching "${filter}". Available: ${TEST_CASES.map(tc => tc.id).join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`\nRunning ${cases.length} tracking test case(s)...`);

  const results = [];
  for (const tc of cases) {
    const ok = await runTestCase(tc);
    results.push({ id: tc.id, description: tc.description, ok });
  }

  // Summary
  console.log('\n' + '='.repeat(55));
  console.log('Summary:');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.id}: ${r.description}`);
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} tracking test cases passed.`);

  // List output files
  console.log('\nOutput files:');
  const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('Track_')).sort();
  for (const f of files) {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
