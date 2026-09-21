#!/usr/bin/env node
/**
 * Day & Ross Public API — Sandbox Test Cases
 *
 * Tests: OAuth auth, GetRate (domestic + cross-border), CreateQuote,
 *        CreateShipment, GetShipmentStatus
 *
 * Run:  node backend/src/scripts/dayrossTestCases.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const { getBaseUrl, refreshOAuthToken, getUserCredentials, httpsPost } = require('../services/dayrossApi.service');

const OUTPUT_DIR = path.resolve(__dirname, '../../../dayross_test_output');
const ACCOUNT = process.env.DAYROSS_ACCOUNT || '0000358377';

// ── Helpers ──────────────────────────────────────────────────────

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function saveFile(name, data) {
  const filePath = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(filePath, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  const kb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`  ✓ Saved ${name} (${kb} KB)`);
}

function saveBase64(name, b64) {
  const buf = Buffer.from(b64, 'base64');
  const filePath = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(filePath, buf);
  console.log(`  ✓ Saved ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}

function sanitizeFilename(str) {
  return str.replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 80);
}

// Unwrap Day & Ross response wrapper (e.g. GetRateResponse, CreateShipmentResponse)
function unwrap(data) {
  if (data.GetRateResponse) {
    // GetRate returns an array
    return Array.isArray(data.GetRateResponse) ? data.GetRateResponse[0] : data.GetRateResponse;
  }
  if (data.CreateShipmentResponse) return data.CreateShipmentResponse;
  if (data.CreateQuoteResponse) return data.CreateQuoteResponse;
  if (data.GetShipmentStatusResponse) return data.GetShipmentStatusResponse;
  if (data.GetShipmentResponse) return data.GetShipmentResponse;
  return data;
}

function _futureDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

// ── Test cases ───────────────────────────────────────────────────

const context = {};

const tests = [
  {
    name: 'Auth: OAuth 2.0 token acquisition',
    fn: async () => {
      const token = await refreshOAuthToken();
      console.log(`  ✓ OAuth token acquired (${token.length} chars)`);
      console.log(`  ✓ Token prefix: ${token.substring(0, 30)}...`);
      context.token = token;
      return { token: `${token.substring(0, 30)}...`, length: token.length };
    },
  },
  {
    name: 'GetRate: Domestic CA→CA (Etobicoke M8W 1Z7 → Vancouver V5K 0A1, 1 pallet 1000lb)',
    fn: async () => {
      const creds = getUserCredentials();
      const body = {
        ...creds,
        serviceLevels: ['LTL'],
        shipmentDetails: {
          billTo: 'C',
          serviceLevel: 'LTL',
          pickUpBy: _futureDate() + 'T08:00:00',
          pickUpByEnd: _futureDate() + 'T17:00:00',
          shipper: {
            city: 'Etobicoke',
            postalCode: 'M8W 1Z7',
            province: 'ON',
            country: 'CA',
          },
          consignee: {
            city: 'Vancouver',
            postalCode: 'V5K 0A1',
            province: 'BC',
            country: 'CA',
          },
          caller: { name: 'IFF Cargo', phone: '416-798-4151', clientId: ACCOUNT },
          details: [{
            description: 'General merchandise',
            length: 48, lengthUnits: 'IN',
            width: 48, widthUnits: 'IN',
            height: 48, heightUnits: 'IN',
            weight: 1000, weightUnits: 'LB',
            pieces: 1, piecesUnits: 'PC',
            pallets: 1, palletUnits: 'PLT',
            dangerousGoods: 'False',
          }],
        },
      };

      saveFile('test_2_GetRate_CA_CA_request.json', body);
      const url = `${getBaseUrl()}/GetRate`;
      const raw = await httpsPost(url, JSON.stringify(body));
      saveFile('test_2_GetRate_CA_CA_response.json', raw);

      const data = unwrap(raw);
      const charges = data.charges || 0;
      const totalCharges = data.totalCharges || 0;
      const transit = data.slmDaysSum || '?';
      const msg = data.message || '';

      if (charges > 0) {
        console.log(`  ✓ Freight: $${charges}, Total: $${totalCharges}, Transit: ${transit} days`);
      } else {
        console.log(`  ⚠ No rate returned. Message: ${msg}`);
      }

      context.domesticRate = data;
      return data;
    },
  },
  {
    name: 'GetRate: Cross-border CA→US (Etobicoke M8W 1Z7 → Chicago 60601, 1 pallet 1000lb)',
    fn: async () => {
      const creds = getUserCredentials();
      const body = {
        ...creds,
        serviceLevels: ['CBLTL'],
        shipmentDetails: {
          billTo: 'C',
          serviceLevel: 'CBLTL',
          pickUpBy: _futureDate() + 'T08:00:00',
          pickUpByEnd: _futureDate() + 'T17:00:00',
          shipper: {
            city: 'Etobicoke',
            postalCode: 'M8W 1Z7',
            province: 'ON',
            country: 'CA',
          },
          consignee: {
            city: 'Chicago',
            postalCode: '60601',
            province: 'IL',
            country: 'US',
          },
          caller: { name: 'IFF Cargo', phone: '416-798-4151', clientId: ACCOUNT },
          details: [{
            commodity: 'CLASS70',
            description: 'General merchandise',
            length: 48, lengthUnits: 'IN',
            width: 48, widthUnits: 'IN',
            height: 48, heightUnits: 'IN',
            weight: 1000, weightUnits: 'LB',
            pieces: 1, piecesUnits: 'PC',
            pallets: 1, palletUnits: 'PLT',
            dangerousGoods: 'False',
          }],
        },
      };

      saveFile('test_3_GetRate_CA_US_request.json', body);
      const url = `${getBaseUrl()}/GetRate`;
      const raw = await httpsPost(url, JSON.stringify(body));
      saveFile('test_3_GetRate_CA_US_response.json', raw);

      const data = unwrap(raw);
      const charges = data.charges || 0;
      const totalCharges = data.totalCharges || 0;
      const transit = data.slmDaysSum || '?';
      const msg = data.message || '';

      if (charges > 0) {
        console.log(`  ✓ Freight: $${charges}, Total: $${totalCharges} ${data.currencyCode || ''}, Transit: ${transit} days`);
      } else {
        console.log(`  ⚠ No rate returned. Message: ${msg}`);
      }
      return data;
    },
  },
  {
    name: 'CreateQuote: Domestic CA→CA (Etobicoke → Montreal, 2 pallets)',
    fn: async () => {
      const creds = getUserCredentials();
      const body = {
        ...creds,
        shipmentDetails: {
          billTo: 'C',
          serviceLevel: 'LTL',
          pickUpBy: _futureDate() + 'T08:00:00',
          pickUpByEnd: _futureDate() + 'T17:00:00',
          shipper: {
            city: 'Etobicoke',
            postalCode: 'M8W 1Z7',
            province: 'ON',
            country: 'CA',
          },
          consignee: {
            city: 'Montreal',
            postalCode: 'H3B 1A7',
            province: 'QC',
            country: 'CA',
          },
          caller: { name: 'IFF Cargo', phone: '416-798-4151', clientId: ACCOUNT },
          details: [
            {
              description: 'Printed materials',
              length: 48, lengthUnits: 'IN',
              width: 40, widthUnits: 'IN',
              height: 36, heightUnits: 'IN',
              weight: 800, weightUnits: 'LB',
              pieces: 1, piecesUnits: 'PC',
              pallets: 1, palletUnits: 'PLT',
              dangerousGoods: 'False',
            },
            {
              description: 'Electronics',
              length: 48, lengthUnits: 'IN',
              width: 40, widthUnits: 'IN',
              height: 48, heightUnits: 'IN',
              weight: 600, weightUnits: 'LB',
              pieces: 1, piecesUnits: 'PC',
              pallets: 1, palletUnits: 'PLT',
              dangerousGoods: 'False',
            },
          ],
        },
      };

      saveFile('test_4_CreateQuote_CA_CA_request.json', body);
      const url = `${getBaseUrl()}/CreateQuote`;
      const raw = await httpsPost(url, JSON.stringify(body));
      saveFile('test_4_CreateQuote_CA_CA_response.json', raw);

      const data = unwrap(raw);
      const quoteNum = data.billNumber || '?';
      const charges = data.charges || 0;
      const totalCharges = data.totalCharges || 0;
      console.log(`  ✓ Quote #${quoteNum}, Freight: $${charges}, Total: $${totalCharges}`);

      // Save quote PDF if returned
      if (raw.quote_report_pdf) {
        saveBase64('test_4_QuoteReport.pdf', raw.quote_report_pdf);
      }

      context.quoteNumber = quoteNum;
      return data;
    },
  },
  {
    name: 'CreateShipment: Domestic CA→CA (Etobicoke → Vancouver)',
    fn: async () => {
      const creds = getUserCredentials();
      const body = {
        ...creds,
        shipmentDetails: {
          billTo: 'C',
          serviceLevel: 'LTL',
          pickUpBy: _futureDate() + 'T08:00:00',
          pickUpByEnd: _futureDate() + 'T17:00:00',
          shipper: {
            name: 'IFF Cargo - Test Shipper',
            address1: '16-296 Atwell Dr',
            city: 'Etobicoke',
            postalCode: 'M8W 1Z7',
            province: 'ON',
            country: 'CA',
            contact: 'Rahman Amir',
            phone: '416-798-4151',
            email: 'info@iffcargo.com',
          },
          consignee: {
            name: 'Test Consignee Vancouver',
            address1: '123 Main St',
            city: 'Vancouver',
            postalCode: 'V5K 0A1',
            province: 'BC',
            country: 'CA',
            contact: 'Test Contact',
            phone: '604-555-0100',
            email: 'test@example.com',
          },
          caller: { name: 'IFF Cargo', phone: '416-798-4151', clientId: ACCOUNT },
          details: [{
            description: 'General merchandise - test shipment',
            length: 48, lengthUnits: 'IN',
            width: 48, widthUnits: 'IN',
            height: 48, heightUnits: 'IN',
            weight: 1000, weightUnits: 'LB',
            pieces: 1, piecesUnits: 'PC',
            pallets: 1, palletUnits: 'PLT',
            dangerousGoods: 'False',
          }],
          traceNumbers: [{ traceType: 'P', traceNumber: 'IFF-TEST-001' }],
        },
      };

      saveFile('test_5_CreateShipment_CA_CA_request.json', body);
      const url = `${getBaseUrl()}/CreateShipment`;
      const raw = await httpsPost(url, JSON.stringify(body));

      // Save response (without base64 blobs for readability)
      const forLog = { ...raw };
      delete forLog.pdf_bol;
      delete forLog.pdf_labels;
      delete forLog.zpl_labels;
      saveFile('test_5_CreateShipment_CA_CA_response.json', forLog);

      const data = unwrap(raw);
      const billNumber = data.billNumber || '?';
      const charges = data.charges || 0;
      const totalCharges = data.totalCharges || 0;
      const transit = data.slmDaysSum || '?';
      console.log(`  ✓ Bill #${billNumber}, Freight: $${charges}, Total: $${totalCharges}, Transit: ${transit} days`);

      // Save BOL PDF
      if (raw.pdf_bol) {
        saveBase64('test_5_BOL.pdf', raw.pdf_bol);
      }

      // Save PDF labels
      if (raw.pdf_labels) {
        saveBase64('test_5_Labels.pdf', raw.pdf_labels);
      }

      // Save ZPL labels
      if (raw.zpl_labels) {
        saveBase64('test_5_Labels.zpl', raw.zpl_labels);
      }

      context.billNumber = billNumber;
      return data;
    },
  },
  {
    name: 'GetShipmentStatus: Track the booked shipment',
    fn: async () => {
      const billNumber = context.billNumber;
      if (!billNumber || billNumber === '?') {
        console.log('  ⚠ Skipping — no billNumber from test 5');
        return { skipped: true };
      }

      const creds = getUserCredentials();
      const body = {
        ...creds,
        shipmentNumber: billNumber,
      };

      saveFile('test_6_GetShipmentStatus_request.json', body);
      const url = `${getBaseUrl()}/GetShipmentStatus`;
      const raw = await httpsPost(url, JSON.stringify(body));
      saveFile('test_6_GetShipmentStatus_response.json', raw);

      const data = unwrap(raw);
      const history = data.statusHistory || data.trackingHistory || [];
      const status = data.statusDescription || data.status || '?';
      console.log(`  ✓ Status: ${status}`);
      console.log(`  ✓ ${history.length} tracking event(s)`);
      if (history.length > 0) {
        for (const e of history.slice(-3)) {
          console.log(`    ${e.date || e.timestamp || ''} | ${e.description || e.statusDescription || ''} | ${e.location || e.terminal || ''}`);
        }
      }
      return data;
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────

(async () => {
  ensureOutputDir();
  console.log('Day & Ross Public API — Sandbox Test Cases');
  console.log(`Base URL: ${getBaseUrl()}`);
  console.log(`Account: ${ACCOUNT}`);
  console.log(`Output:  ${OUTPUT_DIR}\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const num = i + 1;
    console.log(`${'='.repeat(60)}`);
    console.log(`Test ${num}: ${t.name}`);
    console.log(`${'='.repeat(60)}`);

    try {
      const result = await t.fn();
      saveFile(`test_${num}_${sanitizeFilename(t.name.split(':')[0])}.json`, {
        test: t.name,
        status: 'PASS',
        result,
      });
      console.log(`  ✓ PASS\n`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAILED: ${err.message}`);
      saveFile(`test_${num}_${sanitizeFilename(t.name.split(':')[0])}_ERROR.json`, {
        test: t.name,
        status: 'FAIL',
        error: err.message,
        body: err.body || null,
      });
      failed++;
      console.log('');
    }
  }

  console.log('='.repeat(60));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${tests.length}`);
  console.log(`Files saved to: ${OUTPUT_DIR}`);
})();
