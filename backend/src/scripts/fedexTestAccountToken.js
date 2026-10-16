/**
 * Shared by the FedEx Integrator validation scripts.
 *
 * FedEx's test accounts (e.g. CA test account 614365501) can only be used after they've gone
 * through Account Registration (MFA). Rate/Ship/Track calls for that account must then use
 * the account's own CSP token, issued from the child key/secret that registration returns —
 * using the project's parent token instead fails with ACCOUNT.NUMBER.MISMATCH.
 *
 * This registers the account via the Invoice method (the spreadsheet's default sandbox
 * invoice) and returns { accessToken, registrationTxn }.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const https = require('https');
const fedexAuth = require('../services/fedexAuth.service');

// From the "Test Account Numbers" tab — sent exactly as printed (ZIP+4, street on one line),
// otherwise FedEx answers ACCOUNT.ADDRESS.MISMATCH.
const TEST_ACCOUNTS = {
  614365501: { streetLines: ['5985 EXPLORER DR'], city: 'Mississauga', stateOrProvinceCode: 'ON', postalCode: 'L4W5K6', countryCode: 'CA' },
  700257037: { streetLines: ['15 W 18TH ST FL 7'], city: 'NEW YORK', stateOrProvinceCode: 'NY', postalCode: '100114624', countryCode: 'US' },
  740561073: { streetLines: ['40 FED EX PKWY FL 2'], city: 'COLLIERVILLE', stateOrProvinceCode: 'TN', postalCode: '380178711', countryCode: 'US' },
};
const CUSTOMER_NAME = 'IFF Cargo Integrator Test';
const INVOICE = { number: '234562278', currency: 'USD', amount: '234.00' };

function post(url, body, headers, form = false) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const buf = Buffer.from(form ? body : JSON.stringify(body));
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'X-locale': 'en_US', 'Accept-Encoding': 'identity', 'Content-Length': buf.length, ...headers,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
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

const errText = r => r.body.errors?.map(e => `${e.code}: ${e.message}`).join('; ') || JSON.stringify(r.body).slice(0, 200);

async function getTestAccountToken(accountNumber) {
  const address = TEST_ACCOUNTS[accountNumber];
  if (!address) throw new Error(`No registration address on file for test account ${accountNumber}`);

  const base = fedexAuth.getBaseUrl();
  const parent = { Authorization: `Bearer ${await fedexAuth.getToken()}` };

  const addr = await post(`${base}/registration/v2/address/keysgeneration`,
    { accountNumber: { value: accountNumber }, customerName: CUSTOMER_NAME, address: { ...address, residential: false } }, parent);
  const authToken = addr.body.output?.mfaOptions?.[0]?.accountAuthToken;
  if (addr.status !== 200 || !authToken) throw new Error(`Registration address step failed (${addr.status}): ${errText(addr)}`);

  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  const inv = await post(`${base}/registration/v2/invoice/keysgeneration`,
    { invoiceDetail: { ...INVOICE, date: date.toISOString().split('T')[0] }, customerName: CUSTOMER_NAME, locale: 'en_US' },
    { ...parent, accountAuthToken: authToken });
  const out = inv.body.output || {};
  const childKey = out.child_Key || out.childKey;
  const childSecret = out.child_secret || out.childSecret;
  if (inv.status !== 200 || !childKey || !childSecret) throw new Error(`Registration invoice step failed (${inv.status}): ${errText(inv)}`);

  const csp = await post(`${base}/oauth/token`, new URLSearchParams({
    grant_type: 'csp_credentials',
    client_id: process.env.FEDEX_API_KEY,
    client_secret: process.env.FEDEX_SECRET_KEY,
    child_key: childKey,
    child_secret: childSecret,
  }).toString(), {}, true);
  if (csp.status !== 200 || !csp.body.access_token) throw new Error(`CSP token failed (${csp.status}): ${errText(csp)}`);

  return { accessToken: csp.body.access_token, registrationTxn: inv.body.transactionId };
}

module.exports = { getTestAccountToken, TEST_ACCOUNTS };
