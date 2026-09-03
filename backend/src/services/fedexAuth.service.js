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

  const res = await fetch(`${getBaseUrl()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: apiKey,
      client_secret: secretKey,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[FEDEX-AUTH] Token request failed:', res.status, err);
    throw new Error(`FedEx OAuth failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;

  return cachedToken;
}

module.exports = { getToken, getBaseUrl };
