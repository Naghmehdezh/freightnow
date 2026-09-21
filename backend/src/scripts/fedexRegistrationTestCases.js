#!/usr/bin/env node
/**
 * FedEx Integrator Validation — Account Registration Test Cases
 *
 * Runs all 4 Factor 2 authentication methods against the FedEx sandbox and
 * saves JSON request/response files for PIW submission.
 *
 * Per the FedEx test case baseline (MFA sheet), the Credential Registration
 * API at POST /irc/v1/customerkeys is a multi-step endpoint. All steps POST
 * to the same URL, but with different request bodies:
 *
 *   1. Address Validation: { accountNumber: { value }, address, customerName }
 *   2. Pin Generation:     { option: "EMAIL"|"SMS"|"CALL", locale }
 *   3. Pin Validation:     { secureCodePin, customerName }
 *   4. Invoice Validation: { invoiceDetail: { number, date, currency, amount }, customerName, locale }
 *
 * Test cases:
 *   1. PIN via Email
 *   2. PIN via SMS
 *   3. PIN via Phone Call
 *   4. Invoice Validation
 *
 * Usage:
 *   node backend/src/scripts/fedexRegistrationTestCases.js              # all 4 (interactive)
 *   node backend/src/scripts/fedexRegistrationTestCases.js email        # single PIN method
 *   node backend/src/scripts/fedexRegistrationTestCases.js sms
 *   node backend/src/scripts/fedexRegistrationTestCases.js call
 *   node backend/src/scripts/fedexRegistrationTestCases.js invoice      # invoice only
 *   node backend/src/scripts/fedexRegistrationTestCases.js --pin 234560 # provide PIN for all PIN methods
 *
 * Pre-defined sandbox test data (from FedEx test case baseline):
 *   PINs:    234560, 234561, 234562, 234563, 234564, 234565, 234566, 234567, 234568, 234569
 *   Invoice: number "234562278", currency "USD", amount "234.00", date within 6 months
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { getToken, getBaseUrl, httpsPost, invalidateToken } = require('../services/fedexAuth.service');

const OUT_DIR = path.resolve(__dirname, '../../../fedex_test_output');
const ACCOUNT_NUMBER = process.env.FEDEX_ACCOUNT_NUMBER;
const REGISTRATION_ENDPOINT = '/irc/v1/customerkeys';

// ── Test account shipper address (from test case baseline Americas) ──
const TEST_ADDRESS = {
  streetLines: ['15 W 18TH ST FL 7'],
  city: 'NEW YORK',
  stateOrProvinceCode: 'NY',
  postalCode: '100114624',
  countryCode: 'US',
};

// Use the Americas test account if env var matches, else use env var
const AMERICAS_TEST_ACCOUNT = '700257037';

const TEST_CUSTOMER_NAME = 'IFF Cargo Test';

// ── Pre-defined sandbox test data (from FedEx test case baseline) ────
const DEFAULT_PIN = '234560';
const TEST_INVOICE = {
  number: '234562278',
  currency: 'USD',
  amount: '234.00',
  // Must be within 6 months — generate a recent date
  date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
};

// ── Test cases ─────────────────────────────────────────────────────
const TEST_CASES = [
  { id: 'Registration_PIN_Email', method: 'EMAIL', type: 'pin', label: 'PIN via Email' },
  { id: 'Registration_PIN_SMS',   method: 'SMS',   type: 'pin', label: 'PIN via SMS' },
  { id: 'Registration_PIN_Call',  method: 'CALL',  type: 'pin', label: 'PIN via Phone Call' },
  { id: 'Registration_Invoice',   method: null,     type: 'invoice', label: 'Invoice Validation' },
];

// ── Helpers ────────────────────────────────────────────────────────

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function saveJSON(filename, data) {
  const filePath = path.join(OUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`  ✓ Saved ${filename} (${(Buffer.byteLength(JSON.stringify(data, null, 2)) / 1024).toFixed(1)} KB)`);
}

async function fedexApiCall(body) {
  const token = await getToken();
  const url = `${getBaseUrl()}${REGISTRATION_ENDPOINT}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-locale': 'en_US',
  };
  const bodyStr = JSON.stringify(body);

  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      data = await httpsPost(url, bodyStr, headers);
      break;
    } catch (err) {
      if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
        console.log(`  ⚠ Attempt ${attempt + 1} failed (${err.message}), retrying...`);
        if (err.message.includes('401')) {
          invalidateToken();
          const freshToken = await getToken();
          headers.Authorization = `Bearer ${freshToken}`;
        }
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  return data;
}

function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── Request builders (each step has a different body) ─────────────

function buildAddressValidationRequest(accountNumber) {
  return {
    accountNumber: { value: accountNumber || ACCOUNT_NUMBER },
    address: TEST_ADDRESS,
    customerName: TEST_CUSTOMER_NAME,
  };
}

function buildPinGenerationRequest(option) {
  return {
    option,
    locale: 'en_US',
  };
}

function buildPinValidationRequest(pinCode) {
  return {
    secureCodePin: pinCode,
    customerName: TEST_CUSTOMER_NAME,
  };
}

function buildInvoiceValidationRequest() {
  return {
    invoiceDetail: {
      number: TEST_INVOICE.number,
      date: TEST_INVOICE.date,
      currency: TEST_INVOICE.currency,
      amount: TEST_INVOICE.amount,
    },
    customerName: TEST_CUSTOMER_NAME,
    locale: 'en_US',
  };
}

// ── Run a single PIN test case ─────────────────────────────────────

async function runPinTestCase(tc, pinOverride) {
  console.log(`\n━━━ ${tc.label} (${tc.id}) ━━━`);

  // Step 1: Address Validation (Factor 1)
  console.log('  Step 1: Address Validation — Account + Address...');
  const addrRequest = buildAddressValidationRequest();
  try {
    const addrResponse = await fedexApiCall(addrRequest);
    saveJSON(`${tc.id}_step1_request.json`, addrRequest);
    saveJSON(`${tc.id}_step1_response.json`, addrResponse);

    // Check for MFA passthrough (credentials returned directly)
    if (addrResponse.output?.customerKey) {
      console.log('  ✓ MFA passthrough — credentials returned directly!');
      console.log(`    customerKey: ${addrResponse.output.customerKey}`);
      saveJSON(`${tc.id}_request.json`, addrRequest);
      saveJSON(`${tc.id}_response.json`, addrResponse);
      return true;
    }

    console.log('  ✓ Address validated — MFA required');
  } catch (err) {
    console.error(`  ✗ Address Validation failed: ${err.message}`);
    saveJSON(`${tc.id}_step1_request.json`, addrRequest);
    saveJSON(`${tc.id}_step1_error.json`, { error: err.message });
    return false;
  }

  // Step 2: Pin Generation — tell FedEx to deliver the PIN
  console.log(`  Step 2: Pin Generation — Requesting PIN via ${tc.method}...`);
  const pinGenRequest = buildPinGenerationRequest(tc.method);
  try {
    const pinGenResponse = await fedexApiCall(pinGenRequest);
    saveJSON(`${tc.id}_step2_request.json`, pinGenRequest);
    saveJSON(`${tc.id}_step2_response.json`, pinGenResponse);
    console.log('  ✓ PIN delivery requested');
  } catch (err) {
    console.error(`  ✗ Pin Generation failed: ${err.message}`);
    saveJSON(`${tc.id}_step2_request.json`, pinGenRequest);
    saveJSON(`${tc.id}_step2_error.json`, { error: err.message });
    return false;
  }

  // Step 3: Pin Validation — submit the PIN code
  let pinCode = pinOverride;
  if (!pinCode) {
    pinCode = await askQuestion(`  → Enter the 6-digit PIN (sandbox default: ${DEFAULT_PIN}): `);
    if (!pinCode) pinCode = DEFAULT_PIN;
  } else {
    console.log(`  → Using provided PIN: ${pinCode}`);
  }

  if (!/^\d{6}$/.test(pinCode)) {
    console.error('  ✗ Invalid PIN format (must be 6 digits). Skipping verification.');
    return false;
  }

  console.log(`  Step 3: Pin Validation — Verifying PIN ${pinCode}...`);
  const pinValRequest = buildPinValidationRequest(pinCode);
  try {
    const pinValResponse = await fedexApiCall(pinValRequest);
    saveJSON(`${tc.id}_request.json`, pinValRequest);
    saveJSON(`${tc.id}_response.json`, pinValResponse);

    if (pinValResponse.output?.customerKey) {
      console.log('  ✓ PIN Verification successful!');
      console.log(`    customerKey: ${pinValResponse.output.customerKey}`);
    } else {
      console.log('  ✓ Response received (check response JSON for details)');
    }
    return true;
  } catch (err) {
    console.error(`  ✗ Pin Validation failed: ${err.message}`);
    saveJSON(`${tc.id}_request.json`, pinValRequest);
    saveJSON(`${tc.id}_error.json`, { error: err.message });
    return false;
  }
}

// ── Run invoice test case ──────────────────────────────────────────

async function runInvoiceTestCase(tc) {
  console.log(`\n━━━ ${tc.label} (${tc.id}) ━━━`);

  // Step 1: Address Validation (Factor 1)
  console.log('  Step 1: Address Validation — Account + Address...');
  const addrRequest = buildAddressValidationRequest();
  try {
    const addrResponse = await fedexApiCall(addrRequest);
    saveJSON(`${tc.id}_step1_request.json`, addrRequest);
    saveJSON(`${tc.id}_step1_response.json`, addrResponse);

    if (addrResponse.output?.customerKey) {
      console.log('  ✓ MFA passthrough — credentials returned directly!');
      console.log(`    customerKey: ${addrResponse.output.customerKey}`);
      saveJSON(`${tc.id}_request.json`, addrRequest);
      saveJSON(`${tc.id}_response.json`, addrResponse);
      return true;
    }

    console.log('  ✓ Address validated — MFA required');
  } catch (err) {
    console.error(`  ✗ Address Validation failed: ${err.message}`);
    saveJSON(`${tc.id}_step1_request.json`, addrRequest);
    saveJSON(`${tc.id}_step1_error.json`, { error: err.message });
    return false;
  }

  // Step 2: Invoice Validation
  console.log('  Step 2: Invoice Validation...');
  console.log(`    Invoice #${TEST_INVOICE.number}, ${TEST_INVOICE.date}, $${TEST_INVOICE.amount} ${TEST_INVOICE.currency}`);
  const invoiceRequest = buildInvoiceValidationRequest();
  try {
    const invoiceResponse = await fedexApiCall(invoiceRequest);
    saveJSON(`${tc.id}_request.json`, invoiceRequest);
    saveJSON(`${tc.id}_response.json`, invoiceResponse);

    if (invoiceResponse.output?.customerKey) {
      console.log('  ✓ Invoice verification successful!');
      console.log(`    customerKey: ${invoiceResponse.output.customerKey}`);
    } else {
      console.log('  ✓ Response received (check response JSON for details)');
    }
    return true;
  } catch (err) {
    console.error(`  ✗ Invoice Validation failed: ${err.message}`);
    saveJSON(`${tc.id}_request.json`, invoiceRequest);
    saveJSON(`${tc.id}_error.json`, { error: err.message });
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('FedEx Account Registration — Integrator Validation Test Cases');
  console.log('='.repeat(60));

  if (!ACCOUNT_NUMBER) {
    console.error('ERROR: FEDEX_ACCOUNT_NUMBER not set in .env');
    process.exit(1);
  }
  if (!process.env.FEDEX_API_KEY) {
    console.error('ERROR: FEDEX_API_KEY not set in .env');
    process.exit(1);
  }

  console.log(`Account: ${ACCOUNT_NUMBER}`);
  console.log(`Americas test account: ${AMERICAS_TEST_ACCOUNT}`);
  console.log(`Base URL: ${getBaseUrl()}`);
  console.log(`Endpoint: ${REGISTRATION_ENDPOINT}`);
  console.log(`Default PIN: ${DEFAULT_PIN}`);
  console.log(`Invoice: #${TEST_INVOICE.number}, $${TEST_INVOICE.amount} ${TEST_INVOICE.currency}, ${TEST_INVOICE.date}`);

  ensureOutDir();

  // Parse CLI arguments
  const args = process.argv.slice(2);
  let pinOverride = null;
  let filterMethod = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pin' && args[i + 1]) {
      pinOverride = args[i + 1];
      i++;
    } else {
      filterMethod = args[i].toLowerCase();
    }
  }

  // Determine which test cases to run
  let cases = [...TEST_CASES];
  if (filterMethod) {
    const methodMap = { email: 'EMAIL', sms: 'SMS', call: 'CALL', invoice: 'invoice' };
    const target = methodMap[filterMethod];
    if (!target) {
      console.error(`Unknown method: ${filterMethod}. Use: email, sms, call, or invoice`);
      process.exit(1);
    }
    cases = cases.filter(tc => tc.type === 'invoice' ? filterMethod === 'invoice' : tc.method === target);
  }

  console.log(`\nRunning ${cases.length} test case(s)...`);
  if (pinOverride) console.log(`Using PIN override: ${pinOverride}`);

  const results = [];

  for (const tc of cases) {
    let ok;
    if (tc.type === 'pin') {
      ok = await runPinTestCase(tc, pinOverride);
    } else {
      ok = await runInvoiceTestCase(tc);
    }
    results.push({ id: tc.id, label: tc.label, ok });
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('Summary:');
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.label} (${r.id})`);
  }

  const passed = results.filter(r => r.ok).length;
  console.log(`\n${passed}/${results.length} test cases passed.`);

  // List output files
  console.log('\nOutput files:');
  const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('Registration_')).sort();
  for (const f of files) {
    const stat = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f} (${(stat.size / 1024).toFixed(1)} KB)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
