#!/usr/bin/env node
/**
 * FedEx Integrator Validation — Track Test Cases
 *
 * Tracks shipments created by the Ship test cases (IntegratorCA01–CA05) using
 * the FedEx Track API (POST /track/v1/trackingnumbers). Saves request/response
 * JSON for PIW submission evidence.
 *
 * By default, reads tracking numbers from the Ship test case response files.
 * You can also pass tracking numbers directly:
 *
 * Usage:
 *   node backend/src/scripts/fedexTrackTestCases.js                    # track all from ship responses
 *   node backend/src/scripts/fedexTrackTestCases.js 794644790138       # track a specific number
 *   node backend/src/scripts/fedexTrackTestCases.js CA01               # track from CA01 ship response
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getToken, getBaseUrl, httpsPost } = require('../services/fedexAuth.service');

const OUT_DIR = path.resolve(__dirname, '../../../fedex_test_output');

// Extract tracking number from a Ship response JSON file
function getTrackingFromShipResponse(caseId) {
  const responseFile = path.join(OUT_DIR, `${caseId}_response.json`);
  if (!fs.existsSync(responseFile)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(responseFile, 'utf8'));
    return data.output?.transactionShipments?.[0]?.masterTrackingNumber
      || data.output?.transactionShipments?.[0]?.pieceResponses?.[0]?.trackingNumber
      || null;
  } catch { return null; }
}

async function trackNumber(trackingNumber, label, token) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Tracking: ${label} → ${trackingNumber}`);
  console.log('─'.repeat(60));

  const body = {
    trackingInfo: [{
      trackingNumberInfo: { trackingNumber },
    }],
    includeDetailedScans: true,
  };

  const url = `${getBaseUrl()}/track/v1/trackingnumbers`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-locale': 'en_CA',
  };

  // Save request
  const requestFile = path.join(OUT_DIR, `${label}_track_request.json`);
  fs.writeFileSync(requestFile, JSON.stringify(body, null, 2));
  console.log(`  Request  → ${requestFile}`);

  // Call FedEx Track API with retry
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      data = await httpsPost(url, JSON.stringify(body), headers);
      break;
    } catch (err) {
      if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
        console.log(`  Attempt ${attempt + 1} failed (${err.message}), retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      console.error(`  FAILED: ${err.message}`);
      // Save error response if available
      const errorFile = path.join(OUT_DIR, `${label}_track_response_ERROR.json`);
      fs.writeFileSync(errorFile, JSON.stringify({ error: err.message }, null, 2));
      return null;
    }
  }

  // Save response
  const responseFile = path.join(OUT_DIR, `${label}_track_response.json`);
  fs.writeFileSync(responseFile, JSON.stringify(data, null, 2));
  console.log(`  Response → ${responseFile}`);

  // Parse and display results
  const trackResult = data.output?.completeTrackResults?.[0]?.trackResults?.[0];
  if (!trackResult) {
    console.log('  No track results returned');
    return data;
  }

  const status = trackResult.latestStatusDetail;
  console.log(`  Status:  ${status?.statusByLocale || status?.description || 'Unknown'} (code: ${status?.derivedCode || status?.code || '?'})`);

  // Show dates
  const dates = trackResult.dateAndTimes || [];
  for (const d of dates) {
    if (['ESTIMATED_DELIVERY', 'ACTUAL_DELIVERY', 'SHIP'].includes(d.type)) {
      console.log(`  ${d.type}: ${d.dateTime}`);
    }
  }

  // Show scan events
  const scans = trackResult.scanEvents || [];
  console.log(`  Scan events: ${scans.length}`);
  for (const scan of scans.slice(0, 5)) {
    const loc = [scan.scanLocation?.city, scan.scanLocation?.stateOrProvinceCode].filter(Boolean).join(', ');
    console.log(`    ${scan.date} | ${scan.eventDescription || scan.eventType} | ${loc}`);
  }
  if (scans.length > 5) {
    console.log(`    ... and ${scans.length - 5} more events`);
  }

  // Show any errors/notifications
  if (trackResult.error) {
    console.log(`  Error: ${trackResult.error.code} — ${trackResult.error.message}`);
  }

  return data;
}

async function run() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  if (!process.env.FEDEX_API_KEY) {
    console.error('FEDEX_API_KEY not set in .env');
    process.exit(1);
  }

  const token = await getToken();
  console.log('Authenticated with FedEx API ✓');

  const arg = process.argv[2];

  if (arg && !arg.startsWith('CA')) {
    // Direct tracking number passed
    await trackNumber(arg, 'manual', token);
    return;
  }

  // Track from Ship test case responses
  const caseIds = arg
    ? [`Integrator${arg}`]
    : ['IntegratorCA01', 'IntegratorCA02', 'IntegratorCA03', 'IntegratorCA04', 'IntegratorCA05'];

  let tracked = 0;
  for (const caseId of caseIds) {
    const trackingNum = getTrackingFromShipResponse(caseId);
    if (!trackingNum) {
      console.log(`\n  Skipping ${caseId} — no ship response found or no tracking number`);
      continue;
    }
    await trackNumber(trackingNum, caseId, token);
    tracked++;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Done. Tracked ${tracked}/${caseIds.length} shipments.`);
  console.log(`Output saved to: ${OUT_DIR}`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
