const https = require('https');
const zlib = require('zlib');

const TEST_BASE = 'https://uat-cloudapi.estes-express.com';
const PROD_BASE = 'https://cloudapi.estes-express.com';

function isProduction() {
  return process.env.ESTES_ENVIRONMENT === 'production';
}

function getBaseUrl() {
  return isProduction() ? PROD_BASE : TEST_BASE;
}

// The MyEstes login (IFFCargo01) works on both environments now, but with a different password
// per environment — so both the API Key and the MyEstes password have to match whichever
// environment ESTES_ENVIRONMENT actually points at.
function getApiKey() {
  return isProduction() ? process.env.ESTES_PROD_API_KEY : process.env.ESTES_TEST_API_KEY;
}

function getMyEstesPassword() {
  return isProduction() ? process.env.ESTES_MYESTES_PASSWORD_PROD : process.env.ESTES_MYESTES_PASSWORD_TEST;
}

// Estes has three credential layers, not two: Client ID/Secret (used once, out of band, to
// generate the API Key — see scripts/estesApiKeySetup.js) -> API Key + MyEstes portal
// username/password (this file's job) -> Bearer token, which is what every Rate/Tracking/BOL
// call actually authenticates with.
function isConfigured() {
  return !!(getApiKey() && process.env.ESTES_MYESTES_USERNAME && getMyEstesPassword());
}

const REQUEST_TIMEOUT_MS = 20000;

function _request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyBuf = body ? Buffer.from(JSON.stringify(body)) : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'User-Agent': 'IFFCargo/1.0',
        'Accept-Encoding': 'gzip, deflate, identity',
        ...headers,
        ...(bodyBuf && { 'Content-Type': 'application/json', 'Content-Length': bodyBuf.length }),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];

        function handleBody(text) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(text)); } catch { resolve(text); }
          } else {
            console.error(`[ESTES-HTTP] ${method} ${url} failed: ${res.statusCode}`, text.substring(0, 500));
            const err = new Error(`Estes API error (${res.statusCode})`);
            err.statusCode = res.statusCode;
            try { err.body = JSON.parse(text); } catch { err.body = text; }
            reject(err);
          }
        }

        if (encoding === 'gzip') zlib.gunzip(buf, (e, d) => e ? reject(e) : handleBody(d.toString()));
        else if (encoding === 'deflate') zlib.inflate(buf, (e, d) => e ? reject(e) : handleBody(d.toString()));
        else handleBody(buf.toString());
      });
    });

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Estes API request timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Bearer-token auth — POST /authenticate with API key + MyEstes credentials, cache until expiry
// ---------------------------------------------------------------------------

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;

  const apiKey = getApiKey();
  const username = process.env.ESTES_MYESTES_USERNAME;
  const password = getMyEstesPassword();
  if (!apiKey || !username || !password) {
    throw new Error('Estes credentials not configured (API key / ESTES_MYESTES_USERNAME / ESTES_MYESTES_PASSWORD_TEST-or-PROD)');
  }

  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  const data = await _request('POST', `${getBaseUrl()}/authenticate`, {
    apikey: apiKey,
    Authorization: `Basic ${basic}`,
  });

  // Confirmed against a real response: /authenticate returns { "token": "<jwt>" }, not the
  // generic OAuth2 { access_token, expires_in } shape the public docs describe. Expiry (1hr,
  // per the "expires_in" claim embedded inside the JWT itself) is read from the token's own
  // payload rather than a top-level response field.
  const token = data.token || data.access_token;
  if (!token) throw new Error('Estes /authenticate returned no token');

  let expiresInSec = 3600;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (payload.expires_in) expiresInSec = payload.expires_in;
  } catch { /* fall back to the 1hr default above */ }

  cachedToken = token;
  tokenExpiresAt = Date.now() + expiresInSec * 1000;
  return cachedToken;
}

function clearToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function _authenticatedRequest(method, path, body) {
  const apiKey = getApiKey();
  let token = await getToken();
  try {
    return await _request(method, `${getBaseUrl()}${path}`, {
      apikey: apiKey,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    }, body);
  } catch (err) {
    if (err.statusCode === 401) {
      clearToken();
      token = await getToken();
      return _request(method, `${getBaseUrl()}${path}`, {
        apikey: apiKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      }, body);
    }
    throw err;
  }
}

function rateQuote(body) {
  return _authenticatedRequest('POST', '/v1/rate-quotes', body);
}

function trackShipment(pro) {
  return _authenticatedRequest('GET', `/v1/shipments/history?pro=${encodeURIComponent(pro)}`);
}

function createBol(body) {
  return _authenticatedRequest('POST', '/v1/bol', body);
}

// Pickup request: orders the truck (the BOL alone doesn't).
function createPickup(body) {
  return _authenticatedRequest('POST', '/v1/pickup-requests', body);
}

module.exports = { getBaseUrl, isConfigured, getToken, clearToken, rateQuote, trackShipment, createBol, createPickup };
