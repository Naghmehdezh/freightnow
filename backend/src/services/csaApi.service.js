const https = require('https');
const zlib = require('zlib');
const { carriers } = require('../config/env');

const TEST_URL = 'https://tmapi-test.csatransportation.com/tm';
const PROD_URL = 'https://tmapi.csatransportation.com/tm'; // TBD — CSA provides after testing

function getBaseUrl() {
  return process.env.CSA_ENVIRONMENT === 'production' ? PROD_URL : TEST_URL;
}

// ---------------------------------------------------------------------------
// Bearer-token auth — login once, cache until expiry or 401
// ---------------------------------------------------------------------------

let cachedToken = null;
let tokenExpiresAt = 0;

async function login() {
  const { username, password } = carriers.csa;
  if (!username || !password) {
    throw new Error('CSA API credentials not configured (CSA_USERNAME / CSA_PASSWORD)');
  }

  const url = `${getBaseUrl()}/login`;
  const body = JSON.stringify({ username, password });

  console.log('[CSA-HTTP] Logging in...');
  const data = await _rawPost(url, body, {}); // no auth header for login

  // CSA returns { "JWT": "eyJ..." } — extract the token and cache it
  // with a 55-minute TTL (docs don't specify expiry; JWT payload has `exp`)
  const token = typeof data === 'string' ? data : (data.JWT || data.token || data.bearerToken);
  if (!token) throw new Error('CSA login returned no token');

  cachedToken = String(token).replace(/^Bearer\s+/i, '');
  tokenExpiresAt = Date.now() + 55 * 60 * 1000;

  console.log('[CSA-HTTP] Login successful, token cached');
  return cachedToken;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  return login();
}

// Clear cached token (called on 401 before retry)
function clearToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

// ---------------------------------------------------------------------------
// Core HTTP helper — Node.js https module with gzip decompression
// ---------------------------------------------------------------------------

function _rawRequest(method, url, extraHeaders = {}, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        ...extraHeaders,
        'User-Agent': 'IFFCargo/1.0',
        'Accept-Encoding': 'gzip, deflate, identity',
        Accept: 'application/json',
      },
    };

    if (body) {
      const bodyBuf = Buffer.from(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = bodyBuf.length;
    }

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];

        function handleBody(text) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve(text);
            }
          } else {
            console.error(`[CSA-HTTP] ${method} ${url} failed: ${res.statusCode}`, text.substring(0, 500));
            const err = new Error(`CSA API error (${res.statusCode})`);
            err.statusCode = res.statusCode;
            try { err.body = JSON.parse(text); } catch { err.body = text; }
            reject(err);
          }
        }

        if (encoding === 'gzip') {
          zlib.gunzip(buf, (err, decoded) => err ? reject(err) : handleBody(decoded.toString()));
        } else if (encoding === 'deflate') {
          zlib.inflate(buf, (err, decoded) => err ? reject(err) : handleBody(decoded.toString()));
        } else {
          handleBody(buf.toString());
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// POST without auth (used for login)
function _rawPost(url, body, extraHeaders = {}) {
  return _rawRequest('POST', url, extraHeaders, body);
}

// ---------------------------------------------------------------------------
// Authenticated helpers with retry (3 attempts, 500ms delay on 5xx, re-auth on 401)
// ---------------------------------------------------------------------------

async function httpsGet(url, extraHeaders = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await getToken();
      return await _rawRequest('GET', url, { ...extraHeaders, Authorization: `Bearer ${token}` });
    } catch (err) {
      lastErr = err;
      if (err.statusCode === 401 && attempt < 2) {
        console.log('[CSA-HTTP] GET 401 — re-authenticating...');
        clearToken();
        continue;
      }
      if (err.statusCode >= 500 && attempt < 2) {
        console.log(`[CSA-HTTP] GET attempt ${attempt + 1} failed (${err.statusCode}), retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function httpsPost(url, body, extraHeaders = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await getToken();
      return await _rawRequest('POST', url, { ...extraHeaders, Authorization: `Bearer ${token}` }, body);
    } catch (err) {
      lastErr = err;
      if (err.statusCode === 401 && attempt < 2) {
        console.log('[CSA-HTTP] POST 401 — re-authenticating...');
        clearToken();
        continue;
      }
      if (err.statusCode >= 500 && attempt < 2) {
        console.log(`[CSA-HTTP] POST attempt ${attempt + 1} failed (${err.statusCode}), retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { getBaseUrl, login, getToken, clearToken, httpsGet, httpsPost };
