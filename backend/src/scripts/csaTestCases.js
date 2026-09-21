#!/usr/bin/env node
/**
 * CSA Transportation — Sandbox Connectivity & Integration Test Cases
 *
 * Tests: authentication, domestic quote, cross-border quote,
 * multi-piece quote, order booking, and tracking.
 *
 * Usage:
 *   node backend/src/scripts/csaTestCases.js            # all tests
 *   node backend/src/scripts/csaTestCases.js auth        # substring match
 *   node backend/src/scripts/csaTestCases.js 3           # by number
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getBaseUrl, login, httpsPost, httpsGet } = require('../services/csaApi.service');

const OUT_DIR = path.resolve(__dirname, '../../../csa_test_output');

function getNextBusinessDay() {
  const d = new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().split('T')[0];
}

function formatDatetime(dateStr, hour) {
  return `${dateStr}T${String(hour).padStart(2, '0')}:00:00`;
}

// ── Test case definitions ───────────────────────────────────────────

const testCases = [
  // 1. Auth — just login
  {
    id: 1,
    name: 'Auth — Login and get bearer token',
    run: async () => {
      const token = await login();
      return { success: true, tokenLength: token.length, tokenPrefix: token.substring(0, 20) + '...' };
    },
  },

  // 2. Domestic quote: Toronto → Vancouver, 1 skid
  {
    id: 2,
    name: 'Quote CA→CA — Toronto M8W 1Z7 → Vancouver V5K 0A1, 1 skid 48x48x48 1000lb',
    run: async () => {
      const shipDate = getNextBusinessDay();
      const body = {
        orders: [{
          caller: {},
          details: [{
            commodity: 'COM',
            description: 'General merchandise',
            length: 48, lengthUnits: 'IN',
            width: 48, widthUnits: 'IN',
            height: 48, heightUnits: 'IN',
            weight: 1000, weightUnits: 'LB',
            pieces: 1, piecesUnits: 'SKD',
            requestedEquipment: 'LTL',
          }],
          serviceLevel: 'CONSOLIDAT',
          siteId: 'SITE1',
          startZone: 'M8W 1Z7',
          endZone: 'V5K 0A1',
          pickUpBy: formatDatetime(shipDate, 8),
          pickUpByEnd: formatDatetime(shipDate, 16),
          deliverBy: formatDatetime(shipDate, 9),
          deliverByEnd: formatDatetime(shipDate, 17),
          declaredValue: 0,
        }],
      };
      const url = `${getBaseUrl()}/orders?type=Q`;
      const resp = await httpsPost(url, JSON.stringify(body));
      return { request: body, response: resp };
    },
  },

  // 3. Cross-border quote: Toronto → Beverly Hills, 1 skid
  {
    id: 3,
    name: 'Quote CA→US — Toronto M8W 1Z7 → Beverly Hills 90210, 1 skid 48x48x48 1000lb',
    run: async () => {
      const shipDate = getNextBusinessDay();
      const body = {
        orders: [{
          caller: {},
          details: [{
            commodity: 'COM',
            description: 'General merchandise',
            length: 48, lengthUnits: 'IN',
            width: 48, widthUnits: 'IN',
            height: 48, heightUnits: 'IN',
            weight: 1000, weightUnits: 'LB',
            pieces: 1, piecesUnits: 'SKD',
            requestedEquipment: 'LTL',
          }],
          userFields: { user1: 'UPSSCS' },
          serviceLevel: 'CONSOLIDAT',
          siteId: 'SITE1',
          startZone: 'M8W 1Z7',
          endZone: '90210',
          pickUpBy: formatDatetime(shipDate, 8),
          pickUpByEnd: formatDatetime(shipDate, 16),
          deliverBy: formatDatetime(shipDate, 9),
          deliverByEnd: formatDatetime(shipDate, 17),
          declaredValue: 0,
        }],
      };
      const url = `${getBaseUrl()}/orders?type=Q`;
      const resp = await httpsPost(url, JSON.stringify(body));
      return { request: body, response: resp };
    },
  },

  // 4. Multi-piece quote: 2 skids, different dims/weights
  {
    id: 4,
    name: 'Quote multi-piece — 2 skids Toronto → Vancouver, different dims',
    run: async () => {
      const shipDate = getNextBusinessDay();
      const body = {
        orders: [{
          caller: {},
          details: [
            {
              commodity: 'COM', description: 'Bearings',
              length: 48, lengthUnits: 'IN', width: 48, widthUnits: 'IN',
              height: 48, heightUnits: 'IN', weight: 1000, weightUnits: 'LB',
              pieces: 1, piecesUnits: 'SKD', requestedEquipment: 'LTL',
            },
            {
              commodity: 'COM', description: 'Bearings',
              length: 48, lengthUnits: 'IN', width: 40, widthUnits: 'IN',
              height: 72, heightUnits: 'IN', weight: 1400, weightUnits: 'LB',
              pieces: 1, piecesUnits: 'SKD', requestedEquipment: 'LTL',
            },
          ],
          traceNumbers: [{ traceType: 'P', traceNumber: '151111' }],
          aCharges: [{ aChargeCode: 'TAIL-C' }],
          serviceLevel: 'CONSOLIDAT',
          siteId: 'SITE1',
          startZone: 'M8W 1Z7',
          endZone: 'V5K 0A1',
          pickUpBy: formatDatetime(shipDate, 8),
          pickUpByEnd: formatDatetime(shipDate, 17),
          deliverBy: formatDatetime(shipDate, 9),
          deliverByEnd: formatDatetime(shipDate, 17),
          declaredValue: 0,
        }],
      };
      const url = `${getBaseUrl()}/orders?type=Q`;
      const resp = await httpsPost(url, JSON.stringify(body));
      return { request: body, response: resp };
    },
  },

  // 5. Order: domestic CA→CA booking
  {
    id: 5,
    name: 'Order CA→CA — Book Toronto M8W 1Z7 → Vancouver V5K 0A1',
    run: async () => {
      const shipDate = getNextBusinessDay();
      const body = {
        orders: [{
          caller: {},
          shipper: {
            name: 'IFF CARGO TEST',
            address1: '',
            address2: '355 Horner Ave',
            city: 'ETOBICOKE',
            province: 'ON',
            postalCode: 'M8W 1Z7',
            contact: 'Test Shipper',
            phone: '416-555-0100',
            phoneExt: '',
            email: 'test@iffcargo.com',
          },
          consignee: {
            name: 'TEST CONSIGNEE',
            address1: '',
            address2: '1234 Main St',
            city: 'VANCOUVER',
            province: 'BC',
            postalCode: 'V5K 0A1',
            contact: 'Test Receiver',
            phone: '604-555-0200',
            phoneExt: '',
            email: 'test@iffcargo.com',
          },
          details: [{
            commodity: 'COM',
            description: 'General merchandise',
            length: 48, lengthUnits: 'IN',
            width: 48, widthUnits: 'IN',
            height: 48, heightUnits: 'IN',
            weight: 1000, weightUnits: 'LB',
            pieces: 1, piecesUnits: 'SKD',
            requestedEquipment: 'LTL',
          }],
          serviceLevel: 'CONSOLIDAT',
          siteId: 'SITE1',
          startZone: 'M8W 1Z7',
          endZone: 'V5K 0A1',
          pickUpBy: formatDatetime(shipDate, 8),
          pickUpByEnd: formatDatetime(shipDate, 17),
          deliverBy: formatDatetime(shipDate, 9),
          deliverByEnd: formatDatetime(shipDate, 17),
          declaredValue: 0,
        }],
      };
      const url = `${getBaseUrl()}/orders?type=T`;
      const resp = await httpsPost(url, JSON.stringify(body));
      return { request: body, response: resp };
    },
  },

  // 6. Tracking — use orderId from test 5 (or a known test order)
  {
    id: 6,
    name: 'Tracking — GET statusHistory for booked order',
    run: async (context) => {
      // Use orderId from test 5 if available
      const orderId = context.orderIdFromTest5;
      if (!orderId) {
        return { skipped: true, reason: 'No orderId from test 5 — run test 5 first' };
      }
      const url = `${getBaseUrl()}/orders/${orderId}/statusHistory`;
      const resp = await httpsGet(url);
      return { orderId, response: resp };
    },
  },
];

// ── Runner ──────────────────────────────────────────────────────────

async function run() {
  const filter = process.argv[2];

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const selected = filter
    ? testCases.filter(tc =>
        String(tc.id) === filter || tc.name.toLowerCase().includes(filter.toLowerCase()))
    : testCases;

  if (selected.length === 0) {
    console.log(`No tests match "${filter}". Available:`);
    testCases.forEach(tc => console.log(`  ${tc.id}. ${tc.name}`));
    return;
  }

  console.log(`\n=== CSA Transportation Test Suite ===`);
  console.log(`Base URL: ${getBaseUrl()}`);
  console.log(`Running ${selected.length} of ${testCases.length} tests\n`);

  let passed = 0, failed = 0, skipped = 0;
  const context = {};

  for (const tc of selected) {
    const label = `[${tc.id}] ${tc.name}`;
    try {
      console.log(`▶  ${label}`);
      const result = await tc.run(context);

      if (result.skipped) {
        console.log(`   ⊘  SKIPPED — ${result.reason}\n`);
        skipped++;
        continue;
      }

      // Extract useful data for downstream tests
      if (tc.id === 5 && result.response) {
        const orders = result.response.orders || result.response;
        const order = Array.isArray(orders) ? orders[0] : orders;
        if (order && order.orderId) {
          context.orderIdFromTest5 = order.orderId;
          console.log(`   → orderId=${order.orderId}, billNumber=${order.billNumber}`);
        }
      }

      // Validate quote responses (charges > 0)
      if ([2, 3, 4].includes(tc.id) && result.response) {
        const orders = result.response.orders || [];
        const order = orders[0];
        if (order && order.charges > 0) {
          const transit = order.userFieldInt2 || (order.details && order.details[0] && order.details[0].userFieldInt2) || '?';
          console.log(`   → charges=$${order.charges}, transit=${transit} days, total=$${order.totalCharges}`);
        } else if (order && order.charges === 0) {
          console.log(`   ⚠  charges=0 — shipment did not auto-rate`);
        }
      }

      // Save request/response
      const outFile = path.join(OUT_DIR, `test_${tc.id}_${tc.name.replace(/[^a-zA-Z0-9]+/g, '_').substring(0, 50)}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

      console.log(`   ✓  PASS — saved to ${path.basename(outFile)}\n`);
      passed++;
    } catch (err) {
      console.log(`   ✗  FAIL — ${err.message}`);
      if (err.body) console.log(`   Response: ${JSON.stringify(err.body).substring(0, 300)}`);
      console.log();

      // Save error
      const outFile = path.join(OUT_DIR, `test_${tc.id}_ERROR.json`);
      fs.writeFileSync(outFile, JSON.stringify({
        error: err.message,
        statusCode: err.statusCode,
        body: err.body,
      }, null, 2));

      failed++;
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
