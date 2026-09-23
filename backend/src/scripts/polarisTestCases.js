#!/usr/bin/env node
/**
 * Polaris Transportation Group — Sandbox Connectivity & Integration Test Cases
 *
 * Tests: cross-border quote (the only rate scenario Polaris supports live — their Rate API
 * "does not accommodate domestic shipping rates"), a domestic quote (to confirm what the raw
 * API actually does with one, since our adapter never sends it one), order booking, and tracking.
 *
 * Usage:
 *   node backend/src/scripts/polarisTestCases.js            # all tests
 *   node backend/src/scripts/polarisTestCases.js quote       # substring match
 *   node backend/src/scripts/polarisTestCases.js 3           # by number
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const { getBaseUrl, rate, trace, createOrder } = require('../services/polarisApi.service');

const OUT_DIR = path.resolve(__dirname, '../../../polaris_test_output');

function getNextBusinessDay(after) {
  const d = after ? new Date(after + 'T12:00:00') : new Date();
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
  return d.toISOString().split('T')[0];
}

// ── Test case definitions ───────────────────────────────────────────

const testCases = [
  // 1. Cross-border quote: Wisconsin -> Mississauga (the shape from Polaris's own doc example)
  {
    id: 1,
    name: 'Quote US→CA — Janesville WI 53535 → Mississauga L4T 1G7, 3 skids 397lb',
    run: async () => {
      const body = {
        RATE_API: {
          From_PC_ZIP: '53535',
          To_PC_ZIP: 'L4T 1G7',
          Total_Weight_lbs: '397',
          Number_of_Pieces: '15',
          Description: 'TEST',
          ShipInstructions: {
            Inside_Pickup: 'Y', Residential_Pickup: 'N', Lifgate_Pickup: 'N',
            Inside_Delivery: 'N', Residential_Delivery: 'N', Lifgate_Delivery: 'N',
            Appointment_Delivery: 'N', OverSizeFreight: 'N', Do_Not_Stack: 'N',
            In_Bond: 'N', Limited_Access_Pickup: 'N', Limited_Access_Delivery: 'N',
          },
          Number_of_Skids: '3',
          SkidDimensions: [
            { Skid: '1', Length: '48', Width: '48', Height: '40' },
            { Skid: '2', Length: '40', Width: '40', Height: '50' },
            { Skid: '3', Length: '49', Width: '49', Height: '60' },
          ],
        },
      };
      const resp = await rate(body);
      return { request: body, response: resp };
    },
  },

  // 2. Domestic quote: confirm the raw API's own behavior when given a CA->CA route
  // (our adapter never sends this — it falls back to mock before calling live — this test is
  // purely to confirm the documented "cross-border only" limitation is real, not assumed).
  {
    id: 2,
    name: 'Quote CA→CA — Toronto M5V 3A8 → Vancouver V6B 2W2, 1 skid 500lb',
    run: async () => {
      const body = {
        RATE_API: {
          From_PC_ZIP: 'M5V 3A8',
          To_PC_ZIP: 'V6B 2W2',
          Total_Weight_lbs: '500',
          Number_of_Skids: '1',
          ShipInstructions: {
            Inside_Pickup: 'N', Residential_Pickup: 'N', Lifgate_Pickup: 'N',
            Inside_Delivery: 'N', Residential_Delivery: 'N', Lifgate_Delivery: 'N',
            Appointment_Delivery: 'N', OverSizeFreight: 'N', Do_Not_Stack: 'N',
            In_Bond: 'N', Limited_Access_Pickup: 'N', Limited_Access_Delivery: 'N',
          },
          SkidDimensions: [{ Skid: '1', Length: '48', Width: '48', Height: '48' }],
        },
      };
      const resp = await rate(body);
      return { request: body, response: resp, note: 'Expected to error/reject — Polaris Rate API is cross-border only.' };
    },
  },

  // 3. Order booking — cross-border
  {
    id: 3,
    name: 'Order US→CA — Book Janesville WI → Mississauga ON',
    run: async () => {
      const pickupDate = getNextBusinessDay();
      const deliverDate = getNextBusinessDay(pickupDate);
      const body = {
        OrderSubmittion: {
          Shipment_id: `IFFTEST-${Date.now()}`,
          Contact_name: 'Test Shipper',
          Contact_email: 'test@iffcargo.com',
          Pickup_FromTime: `${pickupDate}T13:00:00.0000000`,
          Pickup_ToTime: `${pickupDate}T17:00:00.0000000`,
          Deliver_FromTime: `${deliverDate}T09:00:00.0000000`,
          Deliver_ToTime: `${deliverDate}T17:00:00.0000000`,
          Shipper: {
            name: 'IFF Cargo Test', street1: '12 Morningsun Cres', city: 'Janesville',
            province: 'WI', postalcode: '53546', country: 'US', contact: 'Test Shipper',
            phone: '608-555-0100', email: 'test@iffcargo.com',
          },
          Consignee: {
            name: 'Test Consignee', street1: '7099 Torbram Rd', city: 'Mississauga',
            province: 'ON', postalcode: 'L4T1G7', country: 'CA', contact: 'Test Receiver',
            phone: '905-555-0200', email: 'test@iffcargo.com',
          },
          ShipInstructions: {
            Inside_Pickup_YN: 'N', Residential_Pickup_YN: 'N', Lifgate_Pickup_YN: 'N',
            Inside_Delivery_YN: 'N', Residential_Delivery_YN: 'N', Lifgate_Delivery_YN: 'N',
            Appointment_Delivery_YN: 'N', Call_Ahead_YN: 'N', Do_Not_Stack_YN: 'N',
            Fragile_YN: 'N', In_Bond_YN: 'N', Limited_Access_Pickup_YN: 'N',
            Limited_Access_Delivery_YN: 'N',
          },
          DetailLines: [{
            Seq: '1', Description: 'Test freight', Pallets: '1', TotalWeight: '675',
            WeightUOM: 'LB', Class: '70',
            Skid_Dimension1: { Length: 72, Width: 48, Height: 9 },
          }],
        },
      };
      const resp = await createOrder(body);
      return { request: body, response: resp };
    },
  },

  // 4. Tracking — use the order number from test 3
  {
    id: 4,
    name: 'Tracking — GET Trace for booked order',
    run: async (context) => {
      const orderNumber = context.orderNumberFromTest3;
      if (!orderNumber) {
        return { skipped: true, reason: 'No order number from test 3 — run test 3 first' };
      }
      const resp = await trace(orderNumber);
      return { probill: orderNumber, response: resp };
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

  console.log(`\n=== Polaris Transportation Group Test Suite ===`);
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

      // Extract the order number from test 3 for test 4's tracking lookup
      if (tc.id === 3 && result.response) {
        const resp = result.response.OE_Response || result.response;
        if (resp && resp.Error === 'Y') {
          console.log(`   ⚠  Error=Y — ${resp.Message}`);
        } else if (resp && resp.Order_Number) {
          context.orderNumberFromTest3 = resp.Order_Number;
          console.log(`   → Order_Number=${resp.Order_Number}`);
        }
      }

      // Surface the key figures for quote tests
      if ([1, 2].includes(tc.id) && result.response) {
        const resp = result.response.Rate_API_Response || result.response;
        if (resp && resp.Error === 'Y') {
          console.log(`   ⚠  Error=Y — ${resp.Message}`);
        } else if (resp && resp.Total_Charge) {
          console.log(`   → Total_Charge=$${resp.Total_Charge}, Bill_Number=${resp.Bill_Number}`);
        }
      }

      const outFile = path.join(OUT_DIR, `test_${tc.id}_${tc.name.replace(/[^a-zA-Z0-9]+/g, '_').substring(0, 50)}.json`);
      fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

      console.log(`   ✓  PASS — saved to ${path.basename(outFile)}\n`);
      passed++;
    } catch (err) {
      console.log(`   ✗  FAIL — ${err.message}`);
      if (err.body) console.log(`   Response: ${JSON.stringify(err.body).substring(0, 300)}`);
      console.log();

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
