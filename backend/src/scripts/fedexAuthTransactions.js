#!/usr/bin/env node
/**
 * FedEx Integrator validation — authorization + MFA-bypass registration transactions.
 *
 *   1. Parent authorization   POST /oauth/token  grant_type=client_credentials
 *   2. MFA bypass registration POST /registration/v2/address/keysgeneration
 *        Sweden test account 604849268 (MFA passthrough enabled): child key/secret are
 *        returned directly from the address step — no PIN/invoice.
 *   3. Child authorization    POST /oauth/token  grant_type=csp_credentials
 *        (client credentials + the child credentials from step 2) → bearer token used for
 *        ship/rate/track on behalf of that customer account.
 *
 * Request/response pairs are saved with secrets redacted.
 * Usage:  node src/scripts/fedexAuthTransactions.js [outputDir]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const https = require('https');
const { getBaseUrl } = require('../services/fedexAuth.service');

const OUT_DIR = path.resolve(process.argv[2] || path.join(__dirname, '../../../fedex_test_output/auth_transactions'));

const SECRET_KEYS = /secret|access_token|child_key|child_secret|client_id/i;
const redact = obj => JSON.parse(JSON.stringify(obj, (k, v) => (
  typeof v === 'string' && SECRET_KEYS.test(k) && v.length > 8 ? `${v.slice(0, 6)}…<redacted>` : v
)));

function post(url, body, headers, form) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const buf = Buffer.from(form ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'Accept-Encoding': 'identity', 'Content-Length': buf.length, ...headers,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = { raw: d }; } resolve({ status: res.statusCode, body: j }); });
    });
    req.on('error', e => resolve({ status: 0, body: { error: e.message } }));
    req.write(buf);
    req.end();
  });
}

function save(name, endpoint, requestBody, res) {
  fs.writeFileSync(path.join(OUT_DIR, `${name}_request.json`), JSON.stringify(redact({ endpoint, body: requestBody }), null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${name}_response.json`), JSON.stringify(redact({ httpStatus: res.status, ...res.body }), null, 2));
  const ok = res.status >= 200 && res.status < 300;
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(40)} HTTP ${res.status}${res.body.transactionId ? `  txn ${res.body.transactionId}` : ''}`);
  return ok;
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = getBaseUrl();
  const tokenUrl = `${base}/oauth/token`;

  // 1. Parent authorization
  const parentForm = { grant_type: 'client_credentials', client_id: process.env.FEDEX_API_KEY, client_secret: process.env.FEDEX_SECRET_KEY };
  const parentRes = await post(tokenUrl, new URLSearchParams(parentForm).toString(), {}, true);
  if (!save('Auth_1_Parent_client_credentials', `POST ${tokenUrl}`, parentForm, parentRes)) throw new Error('parent auth failed');
  const parentToken = parentRes.body.access_token;

  // 2. MFA bypass registration — Sweden test account (passthrough)
  const regUrl = `${base}/registration/v2/address/keysgeneration`;
  const regBody = {
    accountNumber: { value: '604849268' },
    customerName: 'IFF Cargo Integrator Test',
    address: { streetLines: ['HAGAGATAN 1, VI'], city: 'STOCKHOLM', postalCode: '11349', countryCode: 'SE', residential: false },
  };
  const regRes = await post(regUrl, regBody, { Authorization: `Bearer ${parentToken}`, 'X-locale': 'en_US' });
  if (!save('Registration_MFA_Bypass_604849268', `POST ${regUrl}`, regBody, regRes)) throw new Error('bypass registration failed');
  const creds = regRes.body.output?.credentials || regRes.body.output || {};

  // 3. Child authorization — client credentials + child credentials
  const childForm = {
    grant_type: 'csp_credentials',
    client_id: process.env.FEDEX_API_KEY,
    client_secret: process.env.FEDEX_SECRET_KEY,
    child_key: creds.child_Key || creds.childKey,
    child_secret: creds.child_secret || creds.childSecret,
  };
  const childRes = await post(tokenUrl, new URLSearchParams(childForm).toString(), {}, true);
  if (!save('Auth_2_Child_csp_credentials', `POST ${tokenUrl}`, childForm, childRes)) throw new Error('child auth failed');

  console.log(`\nSaved to ${OUT_DIR} (secrets redacted)`);
}

run().catch((err) => { console.error('FATAL:', err.message); process.exit(1); });
