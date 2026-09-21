const https = require('https');
const zlib = require('zlib');
const { carriers } = require('../config/env');

const TEST_URL = 'https://express.api.dhl.com/mydhlapi/test';
const PROD_URL = 'https://express.api.dhl.com/mydhlapi';

function getBaseUrl() {
  return process.env.DHL_ENVIRONMENT === 'production' ? PROD_URL : TEST_URL;
}

function getAuthHeader() {
  const { username, password } = carriers.dhl;
  if (!username || !password) {
    throw new Error('DHL API credentials not configured (DHL_USERNAME / DHL_PASSWORD)');
  }
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

// ---------------------------------------------------------------------------
// Core HTTP helper — supports GET, POST, DELETE via Node.js https module.
// Uses the same decompression pattern as fedexAuth.service.js (gzip/deflate).
// Retry: 3 attempts with 500ms delay on 5xx errors.
// ---------------------------------------------------------------------------

function httpsRequest(method, url, extraHeaders = {}, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        ...extraHeaders,
        Authorization: getAuthHeader(),
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
            console.error(`[DHL-HTTP] ${method} ${url} failed: ${res.statusCode}`, text.substring(0, 500));
            const err = new Error(`DHL API error (${res.statusCode})`);
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

// ---------------------------------------------------------------------------
// Public helpers with retry logic (3 attempts, 500ms delay on 5xx)
// ---------------------------------------------------------------------------

async function httpsGet(url, extraHeaders = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await httpsRequest('GET', url, extraHeaders);
    } catch (err) {
      lastErr = err;
      if (err.statusCode >= 500 && attempt < 2) {
        console.log(`[DHL-HTTP] GET attempt ${attempt + 1} failed (${err.statusCode}), retrying...`);
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
      return await httpsRequest('POST', url, extraHeaders, body);
    } catch (err) {
      lastErr = err;
      if (err.statusCode >= 500 && attempt < 2) {
        console.log(`[DHL-HTTP] POST attempt ${attempt + 1} failed (${err.statusCode}), retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function httpsDelete(url, extraHeaders = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await httpsRequest('DELETE', url, extraHeaders);
    } catch (err) {
      lastErr = err;
      if (err.statusCode >= 500 && attempt < 2) {
        console.log(`[DHL-HTTP] DELETE attempt ${attempt + 1} failed (${err.statusCode}), retrying...`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { getBaseUrl, getAuthHeader, httpsGet, httpsPost, httpsDelete };
