#!/usr/bin/env node
/**
 * FedEx Account Registration API (v2) — Integrator validation, "MFA" tab of
 * FedEx_Integrator_Test_Case_Baseline.xlsx.
 *
 * Flow per method, all on one test account (the spreadsheet asks for SMS, CALL, EMAIL and
 * INVOICE on the same account):
 *   1. Address validation   POST /registration/v2/address/keysgeneration  -> accountAuthToken
 *      (steps 2a-2c send it as an `accountAuthToken` header alongside the parent Bearer token)
 *   2a. PIN generation      POST /registration/v2/customerkeys/pingeneration   (SMS/CALL/EMAIL)
 *   2b. PIN validation      POST /registration/v2/pin/keysgeneration           -> child key/secret
 *   2c. Invoice validation  POST /registration/v2/invoice/keysgeneration       -> child key/secret
 *   3. CSP token            POST /oauth/token grant_type=csp_credentials (proves the child keys work)
 *
 * Sandbox only. Uses the spreadsheet's default PINs / invoice. Child secrets are never printed.
 *
 * Usage:  node src/scripts/fedexRegistrationV2TestCases.js [accountNumber]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const https = require('https');
const fedexAuth = require('../services/fedexAuth.service');

const OUT_DIR = path.resolve(__dirname, '../../../fedex_test_output/registration_v2');

// From the "Test Account Numbers" tab. Address must be sent exactly like this (ZIP+4, street
// on one line) — FedEx returns ACCOUNT.ADDRESS.MISMATCH for a 5-digit ZIP or split street lines.
const ACCOUNTS = {
  700257037: { streetLines: ['15 W 18TH ST FL 7'], city: 'NEW YORK', stateOrProvinceCode: 'NY', postalCode: '100114624', countryCode: 'US' },
  614365501: { streetLines: ['5985 EXPLORER DR'], city: 'Mississauga', stateOrProvinceCode: 'ON', postalCode: 'L4W5K6', countryCode: 'CA' },
  740561073: { streetLines: ['40 FED EX PKWY FL 2'], city: 'COLLIERVILLE', stateOrProvinceCode: 'TN', postalCode: '380178711', countryCode: 'US' },
};
const DEFAULT_PIN = '234560';
const INVOICE = { number: '234562278', currency: 'USD', amount: '234.00' };
const CUSTOMER_NAME = 'IFF Cargo Integrator Test';

function redact(obj) {
  return JSON.parse(JSON.stringify(obj, (k, v) => (
    typeof v === 'string' && /secret|accountAuthToken|access_token|child_?key/i.test(k) ? `${v.slice(0, 6)}…<redacted>` : v
  )));
}

function post(url, body, headers) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-locale': 'en_US', 'Content-Length': buf.length, ...headers },
    }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        let json; try { json = JSON.parse(d); } catch { json = { raw: d }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.write(buf);
    req.end();
  });
}

function recentDate() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1); // must be a valid date no older than 6 months
  return d.toISOString().split('T')[0];
}

async function step(label, file, url, body, headers) {
  const res = await post(url, body, headers);
  const txn = res.body.transactionId || '—';
  const ok = res.status >= 200 && res.status < 300;
  const err = res.body.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || '';
  console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(22)} HTTP ${res.status}  txn ${txn}${err ? `  ${err}` : ''}`);
  fs.writeFileSync(path.join(OUT_DIR, `${file}_request.json`), JSON.stringify(redact(body), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${file}_response.json`), JSON.stringify(redact(res.body), null, 2));
  return { ok, status: res.status, body: res.body, txn };
}

async function run() {
  const acct = process.argv[2] || '700257037';
  const address = ACCOUNTS[acct];
  if (!address) throw new Error(`No address on file for ${acct} (known: ${Object.keys(ACCOUNTS).join(', ')})`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const base = fedexAuth.getBaseUrl();
  const parentToken = await fedexAuth.getToken();
  const parent = { Authorization: `Bearer ${parentToken}` };
  const summary = [];

  for (const method of ['EMAIL', 'SMS', 'CALL', 'INVOICE']) {
    console.log(`\n── ${method} (account ${acct}) ──`);
    const tag = `${acct}_${method}`;

    const addr = await step('Address validation', `${tag}_1_address`, `${base}/registration/v2/address/keysgeneration`,
      { accountNumber: { value: acct }, customerName: CUSTOMER_NAME, address: { ...address, residential: false } }, parent);
    const mfa = addr.body.output?.mfaOptions?.[0];
    if (!addr.ok || !mfa?.accountAuthToken) { summary.push({ method, ok: false, txn: addr.txn }); continue; }
    // Factor 2 calls keep the parent OAuth token as the Bearer and carry the account-scoped
    // token from address validation in its own `accountAuthToken` header (confirmed live:
    // sending it as the Bearer returns 401 "Invalid CXS JWT").
    const acctAuth = { ...parent, accountAuthToken: mfa.accountAuthToken };

    let keys;
    if (method === 'INVOICE') {
      keys = await step('Invoice validation', `${tag}_2_invoice`, `${base}/registration/v2/invoice/keysgeneration`,
        { invoiceDetail: { ...INVOICE, date: recentDate() }, customerName: CUSTOMER_NAME, locale: 'en_US' }, acctAuth);
    } else {
      const gen = await step('PIN generation', `${tag}_2_pingeneration`, `${base}/registration/v2/customerkeys/pingeneration`,
        { option: method, locale: 'en_US' }, acctAuth);
      if (!gen.ok) { summary.push({ method, ok: false, txn: gen.txn }); continue; }
      keys = await step('PIN validation', `${tag}_3_pinvalidation`, `${base}/registration/v2/pin/keysgeneration`,
        { secureCodePin: DEFAULT_PIN, customerName: CUSTOMER_NAME }, acctAuth);
    }

    const out = keys.body.output || {};
    const childKey = out.child_Key || out.childKey || out.child_key;
    const childSecret = out.child_secret || out.childSecret || out.child_Secret;
    if (!keys.ok || !childKey || !childSecret) { summary.push({ method, ok: false, txn: keys.txn }); continue; }

    // CSP token: prove the issued child credentials actually authenticate.
    const csp = await post(`${base}/oauth/token`, new URLSearchParams({
      grant_type: 'csp_credentials',
      client_id: process.env.FEDEX_API_KEY,
      client_secret: process.env.FEDEX_SECRET_KEY,
      child_key: childKey,
      child_secret: childSecret,
    }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
    const cspOk = csp.status === 200 && !!csp.body.access_token;
    console.log(`  ${cspOk ? '✓' : '✗'} ${'CSP token'.padEnd(22)} HTTP ${csp.status}${cspOk ? '' : `  ${JSON.stringify(csp.body).slice(0, 200)}`}`);
    summary.push({ method, ok: cspOk, txn: keys.txn });
  }

  console.log('\n== Summary ==');
  summary.forEach(s => console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.method.padEnd(8)} key txn ${s.txn}`));
  console.log(`\nRequests/responses (secrets redacted): ${OUT_DIR}`);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
