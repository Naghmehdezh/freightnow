const https = require('https');
const { carriers } = require('../config/env');

const SANDBOX_URL = 'https://apis-sandbox.fedex.com';
const PROD_URL = 'https://apis.fedex.com';

let cachedToken = null;
let tokenExpiresAt = 0;
let refreshPromise = null;

function getBaseUrl() {
  return process.env.FEDEX_ENVIRONMENT === 'production' ? PROD_URL : SANDBOX_URL;
}

async function getToken() {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  // If a refresh is already in-flight, wait for it
  if (refreshPromise) return refreshPromise;

  refreshPromise = fetchNewToken();
  try {
    const token = await refreshPromise;
    return token;
  } finally {
    refreshPromise = null;
  }
}

async function fetchNewToken() {
  const { apiKey, secretKey } = carriers.fedex;
  if (!apiKey || !secretKey) {
    throw new Error('FedEx API credentials not configured (FEDEX_API_KEY / FEDEX_SECRET_KEY)');
  }

  const data = await httpsPost(
    `${getBaseUrl()}/oauth/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: apiKey,
      client_secret: secretKey,
    }).toString(),
    { 'Content-Type': 'application/x-www-form-urlencoded' },
  );

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// Use Node.js https module instead of fetch — the MongoDB driver's network
// layer interferes with undici-based fetch in Node.js v26, causing 401 errors
// on FedEx's API Gateway.
function httpsPost(url, body, extraHeaders = {}) {
  const zlib = require('zlib');
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyBuf = Buffer.from(body);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        ...extraHeaders,
        'Content-Length': bodyBuf.length,
        'User-Agent': 'IFFCargo/1.0',
        'Accept-Encoding': 'gzip, deflate, identity',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];

        function handleBody(text) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(text));
          } else {
            console.error(`[FEDEX-HTTP] ${url} failed: ${res.statusCode}`, text.substring(0, 300));
            reject(new Error(`FedEx API error (${res.statusCode})`));
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
    req.write(bodyBuf);
    req.end();
  });
}

function invalidateToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

module.exports = { getToken, getBaseUrl, httpsPost, invalidateToken };
