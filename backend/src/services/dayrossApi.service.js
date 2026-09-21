const https = require('https');
const zlib = require('zlib');
const { carriers } = require('../config/env');

// Day & Ross API endpoints
const TEST_BASE = 'https://apis-test.dayross.biz/api/public/v1';
const PROD_BASE = 'https://apis.dayross.biz/api/public/v1'; // production TBD

// OAuth 2.0 token endpoint (Informatica Cloud)
const OAUTH_URL = 'https://dm-us.informaticacloud.com/authz-service/oauth/token?grant_type=client_credentials';

function getBaseUrl() {
  return process.env.DAYROSS_ENVIRONMENT === 'production' ? PROD_BASE : TEST_BASE;
}

// ---------------------------------------------------------------------------
// OAuth 2.0 — client_credentials flow, token refreshes every 30 minutes
// ---------------------------------------------------------------------------

let cachedOAuthToken = null;
let oauthExpiresAt = 0;

async function getOAuthToken() {
  if (cachedOAuthToken && Date.now() < oauthExpiresAt) return cachedOAuthToken;
  return refreshOAuthToken();
}

async function refreshOAuthToken() {
  const basicAuth = carriers.dayross.oauthBasic || process.env.DAYROSS_OAUTH_BASIC;
  if (!basicAuth) {
    throw new Error('Day & Ross OAuth credentials not configured (DAYROSS_OAUTH_BASIC)');
  }

  console.log('[DAYROSS-HTTP] Refreshing OAuth token...');
  const data = await _rawPost(OAUTH_URL, '', {
    Authorization: `Basic ${basicAuth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  });

  const token = data.access_token || data.token;
  if (!token) throw new Error('Day & Ross OAuth returned no access_token');

  cachedOAuthToken = token;
  // Token valid for 30 minutes per docs; refresh at 28 min to be safe
  oauthExpiresAt = Date.now() + 28 * 60 * 1000;

  console.log('[DAYROSS-HTTP] OAuth token acquired');
  return cachedOAuthToken;
}

function clearOAuthToken() {
  cachedOAuthToken = null;
  oauthExpiresAt = 0;
}

// ---------------------------------------------------------------------------
// User credentials — included in every API request body
// ---------------------------------------------------------------------------

function getUserCredentials() {
  const email = carriers.dayross.email || process.env.DAYROSS_EMAIL;
  const password = carriers.dayross.password || process.env.DAYROSS_PASSWORD;
  if (!email || !password) {
    throw new Error('Day & Ross user credentials not configured (DAYROSS_EMAIL / DAYROSS_PASSWORD)');
  }
  return { emailAddress: email, password };
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
      if (!options.headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
      options.headers['Content-Length'] = bodyBuf.length;
    }

    // 30-second timeout — Day & Ross sandbox can be slow
    options.timeout = 30000;

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
            console.error(`[DAYROSS-HTTP] ${method} ${url} failed: ${res.statusCode}`, text.substring(0, 500));
            const err = new Error(`Day & Ross API error (${res.statusCode})`);
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

    req.on('timeout', () => { req.destroy(new Error('Day & Ross request timed out (30s)')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function _rawPost(url, body, extraHeaders = {}) {
  return _rawRequest('POST', url, extraHeaders, body);
}

// ---------------------------------------------------------------------------
// Authenticated POST — all Day & Ross APIs are POST with OAuth + user creds
// ---------------------------------------------------------------------------

async function httpsPost(url, body, extraHeaders = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const token = await getOAuthToken();
      return await _rawRequest('POST', url, {
        ...extraHeaders,
        Authorization: `Bearer ${token}`,
      }, body);
    } catch (err) {
      lastErr = err;
      if (err.statusCode === 401 && attempt < 2) {
        console.log('[DAYROSS-HTTP] POST 401 — refreshing OAuth token...');
        clearOAuthToken();
        continue;
      }
      if ((err.statusCode >= 500 || err.message?.includes('timed out')) && attempt < 2) {
        const delay = 1000 * (attempt + 1); // 1s, then 2s
        console.log(`[DAYROSS-HTTP] POST attempt ${attempt + 1} failed (${err.statusCode || 'timeout'}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = {
  getBaseUrl,
  getOAuthToken,
  refreshOAuthToken,
  clearOAuthToken,
  getUserCredentials,
  httpsPost,
};
