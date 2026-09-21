#!/usr/bin/env node
/**
 * DHL Express Certification — Pickup Test Cases
 *
 * Runs all 4 pickup test cases against the DHL sandbox and saves
 * JSON request/response files for certification submission.
 *
 * Test cases (from certification spreadsheet Tab 2):
 *   1. Pickup in Canada
 *   2. Remote pickup in another country
 *   3. Create pickup and then cancel request
 *   4. Create pickup for a future date
 *
 * Usage:
 *   node backend/src/scripts/dhlPickupTestCases.js        # all 4
 *   node backend/src/scripts/dhlPickupTestCases.js 3      # single case by number
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getBaseUrl, httpsPost, httpsDelete } = require('../services/dhlApi.service');

const OUT_DIR = path.resolve(__dirname, '../../../dhl_test_output');
const ACCOUNT_NUMBER = process.env.DHL_ACCOUNT_NUMBER || '971410088';

// ── Helper dates ──────────────────────────────────────────────────

function getBusinessDaysAhead(days) {
  const d = new Date();
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

function getFutureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().split('T')[0];
}

// ── Pickup request builders ───────────────────────────────────────

function buildPickupRequest(tc) {
  return {
    plannedPickupDateAndTime: `${tc.pickupDate}T${tc.pickupTime}`,
    closeTime: tc.closeTime,
    location: tc.location || 'reception',
    locationType: tc.locationType || 'business',
    accounts: [
      { typeCode: 'shipper', number: ACCOUNT_NUMBER },
    ],
    customerDetails: {
      shipperDetails: {
        postalAddress: tc.address,
        contactInformation: tc.contact,
      },
    },
    shipmentDetails: [
      {
        productCode: 'P',
        isCustomsDeclarable: false,
        unitOfMeasurement: 'metric',
        packages: [
          { weight: 5, dimensions: { length: 30, width: 20, height: 15 } },
        ],
      },
    ],
    specialInstructions: [{ value: tc.instructions || 'Test pickup for DHL certification' }],
  };
}

// ── Test cases ────────────────────────────────────────────────────

const TEST_CASES = [
  {
    num: 1,
    id: 'Pickup_1',
    description: 'Pickup in Canada',
    pickupDate: getBusinessDaysAhead(2),
    pickupTime: '10:00:00',
    closeTime: '17:00',
    address: {
      postalCode: 'H2Y 1C6',
      cityName: 'MONTREAL',
      countryCode: 'CA',
      provinceCode: 'QC',
      addressLine1: '400 Rue Notre-Dame O',
    },
    contact: {
      phone: '+15141234567',
      companyName: 'International Freight Forwarders',
      fullName: 'IFF Cargo Test',
      email: 'test@iffcargo.com',
    },
    instructions: 'Canadian domestic pickup test',
    shouldCancel: false,
  },
  {
    num: 2,
    id: 'Pickup_2',
    description: 'Remote pickup in another city (Vancouver)',
    pickupDate: getBusinessDaysAhead(3),
    pickupTime: '09:00:00',
    closeTime: '16:00',
    address: {
      postalCode: 'V6B 2W2',
      cityName: 'VANCOUVER',
      countryCode: 'CA',
      provinceCode: 'BC',
      addressLine1: '200 Burrard Street',
    },
    contact: {
      phone: '+16041234567',
      companyName: 'Test Remote Pickup',
      fullName: 'Remote Test',
      email: 'remote@iffcargo.com',
    },
    instructions: 'Remote city pickup test - Vancouver',
    shouldCancel: false,
  },
  {
    num: 3,
    id: 'Pickup_3',
    description: 'Create pickup then cancel',
    pickupDate: getBusinessDaysAhead(2),
    pickupTime: '11:00:00',
    closeTime: '18:00',
    address: {
      postalCode: 'L6T 5M1',
      cityName: 'BRAMPTON',
      countryCode: 'CA',
      provinceCode: 'ON',
      addressLine1: '18 Parkshore Drive',
    },
    contact: {
      phone: '+19051234567',
      companyName: 'International Freight Forwarders',
      fullName: 'IFF Cancel Test',
      email: 'test@iffcargo.com',
    },
    instructions: 'Pickup to be cancelled immediately',
    shouldCancel: true,
  },
  {
    num: 4,
    id: 'Pickup_4',
    description: 'Create pickup for a future date',
    pickupDate: getFutureDate(7),
    pickupTime: '10:00:00',
    closeTime: '17:00',
    address: {
      postalCode: 'M5V 2T6',
      cityName: 'TORONTO',
      countryCode: 'CA',
      provinceCode: 'ON',
      addressLine1: '100 King Street W',
    },
    contact: {
      phone: '+14161234567',
      companyName: 'International Freight Forwarders',
      fullName: 'IFF Future Test',
      email: 'test@iffcargo.com',
    },
    instructions: 'Future date pickup test - 7 days ahead',
    shouldCancel: false,
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

// ── Run a single pickup test case ─────────────────────────────────

async function runTestCase(tc) {
  console.log(`\n━━━ ${tc.id}: ${tc.description} ━━━`);

  const request = buildPickupRequest(tc);
  let createOk = false;
  let cancelOk = !tc.shouldCancel; // If we don't need to cancel, it's "ok" by default

  // Step 1: Create pickup
  console.log(`  Creating pickup for ${tc.pickupDate} at ${tc.address.cityName}, ${tc.address.countryCode}...`);
  try {
    const response = await httpsPost(
      `${getBaseUrl()}/pickups`,
      JSON.stringify(request),
    );
    saveJSON(`${tc.id}_request.json`, request);
    saveJSON(`${tc.id}_response.json`, response);

    const confirmationNumber = response.dispatchConfirmationNumber
      || (response.dispatchConfirmationNumbers && response.dispatchConfirmationNumbers[0]);
    if (confirmationNumber) {
      console.log(`  → Confirmation: ${confirmationNumber}`);
    } else {
      console.log('  → Pickup created (check JSON for details)');
    }
    createOk = true;

    // Step 2: Cancel pickup (test case 3 only)
    if (tc.shouldCancel && confirmationNumber) {
      console.log(`  Cancelling pickup ${confirmationNumber}...`);
      const cancelParams = new URLSearchParams({
        requestorName: tc.contact.fullName,
        reason: 'Testing - pickup created for certification and needs to be cancelled',
      });
      const cancelUrl = `${getBaseUrl()}/pickups/${confirmationNumber}?${cancelParams.toString()}`;
      try {
        const cancelResponse = await httpsDelete(cancelUrl);
        saveJSON(`${tc.id}_cancel_request.json`, { method: 'DELETE', url: cancelUrl, queryParams: { requestorName: tc.contact.fullName, reason: 'Testing - pickup created for certification and needs to be cancelled' } });
        saveJSON(`${tc.id}_cancel_response.json`, cancelResponse);
        console.log('  → Pickup cancelled successfully');
        cancelOk = true;
      } catch (cancelErr) {
        console.error(`  ✗ Cancel failed: ${cancelErr.message}`);
        saveJSON(`${tc.id}_cancel_request.json`, { method: 'DELETE', url: cancelUrl });
        saveJSON(`${tc.id}_cancel_error.json`, {
          error: cancelErr.message,
          statusCode: cancelErr.statusCode,
          body: cancelErr.body,
        });
      }
    } else if (tc.shouldCancel) {
      console.log('  ⚠ No confirmation number returned — cannot cancel');
    }
  } catch (err) {
    console.error(`  ✗ Create failed: ${err.message}`);
    saveJSON(`${tc.id}_request.json`, request);
    saveJSON(`${tc.id}_error.json`, {
      error: err.message,
      statusCode: err.statusCode,
      body: err.body,
    });
  }

  return { createOk, cancelOk };
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('DHL Express — Pickup Certification Test Cases');
  console.log('='.repeat(50));
  console.log(`Base URL: ${getBaseUrl()}`);
  console.log(`Account: ${ACCOUNT_NUMBER}`);

  ensureOutDir();

  // Parse CLI arguments
  const filter = process.argv[2];
  let cases = [...TEST_CASES];
  if (filter) {
    cases = cases.filter(tc =>
      tc.id.includes(filter) ||
      String(tc.num) === filter ||
      tc.description.toLowerCase().includes(filter.toLowerCase())
    );
    if (cases.length === 0) {
      console.error(`No test cases matching "${filter}". Available:`);
      TEST_CASES.forEach(tc => console.error(`  ${tc.num}. ${tc.id} — ${tc.description}`));
      process.exit(1);
    }
  }

  console.log(`\nRunning ${cases.length} pickup test case(s)...`);

  const results = [];
  for (const tc of cases) {
    const { createOk, cancelOk } = await runTestCase(tc);
    results.push({ num: tc.num, id: tc.id, description: tc.description, createOk, cancelOk });
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('Summary:');
  for (const r of results) {
    const icon = r.createOk && r.cancelOk ? '✓' : '✗';
    const extra = r.num === 3 ? ` (cancel: ${r.cancelOk ? '✓' : '✗'})` : '';
    console.log(`  ${icon} ${r.id}: ${r.description}${extra}`);
  }

  const passed = results.filter(r => r.createOk && r.cancelOk).length;
  console.log(`\n${passed}/${results.length} pickup test cases passed.`);

  // List output files
  console.log('\nOutput files:');
  const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('Pickup_')).sort();
  for (const f of files) {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
