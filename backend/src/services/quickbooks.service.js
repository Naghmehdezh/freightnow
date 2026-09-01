const QBToken = require('../models/QBToken');
const { quickbooks } = require('../config/env');

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function getBaseUrl() {
  return quickbooks.environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function getPaymentsBaseUrl() {
  return quickbooks.environment === 'production'
    ? 'https://api.intuit.com'
    : 'https://sandbox.api.intuit.com';
}

// Generate the OAuth2 authorization URL for the admin to connect QB
function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: quickbooks.clientId,
    redirect_uri: quickbooks.redirectUri,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment',
    state: state || 'connect',
  });
  return `${INTUIT_AUTH_URL}?${params}`;
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code, realmId, userId) {
  console.log('[QB] Exchanging code for tokens...');
  console.log('[QB] Redirect URI:', quickbooks.redirectUri);
  console.log('[QB] Code:', code.substring(0, 10) + '...');
  console.log('[QB] Realm ID:', realmId);

  const res = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${quickbooks.clientId}:${quickbooks.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: quickbooks.redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    console.error('[QB] Token exchange failed:', JSON.stringify(err));
    throw new Error(`QB token exchange failed: ${err.error_description || err.error || res.status}`);
  }

  const data = await res.json();
  const now = new Date();

  const mongoose = require('mongoose');
  const isValidId = mongoose.Types.ObjectId.isValid(userId);

  await QBToken.findOneAndUpdate(
    { realmId },
    {
      realmId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessTokenExpiresAt: new Date(now.getTime() + data.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now.getTime() + data.x_refresh_token_expires_in * 1000),
      ...(isValidId && { connectedBy: userId }),
    },
    { upsert: true, new: true }
  );

  return { realmId, connected: true };
}

// Refresh an expired access token
async function refreshAccessToken(tokenDoc) {
  const res = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${quickbooks.clientId}:${quickbooks.clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenDoc.refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`QB token refresh failed: ${err.error_description || err.error}`);
  }

  const data = await res.json();
  const now = new Date();

  tokenDoc.accessToken = data.access_token;
  tokenDoc.refreshToken = data.refresh_token;
  tokenDoc.accessTokenExpiresAt = new Date(now.getTime() + data.expires_in * 1000);
  tokenDoc.refreshTokenExpiresAt = new Date(now.getTime() + data.x_refresh_token_expires_in * 1000);
  await tokenDoc.save();

  return tokenDoc;
}

// Get a valid access token (auto-refreshes if expired)
async function getValidToken() {
  const tokenDoc = await QBToken.findOne().sort({ updatedAt: -1 });
  if (!tokenDoc) throw new Error('QuickBooks not connected. An admin must connect via /api/quickbooks/connect');

  if (tokenDoc.refreshTokenExpiresAt < new Date()) {
    throw new Error('QuickBooks refresh token expired. Admin must reconnect.');
  }

  // Refresh if access token expires within 5 minutes
  if (tokenDoc.accessTokenExpiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
    return refreshAccessToken(tokenDoc);
  }

  return tokenDoc;
}

// Make an authenticated request to QuickBooks API
async function qbRequest(method, path, body, isPayments = false) {
  const tokenDoc = await getValidToken();
  const baseUrl = isPayments ? getPaymentsBaseUrl() : getBaseUrl();
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${tokenDoc.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`QB API error (${res.status}): ${err}`);
  }

  return res.json();
}

// Check connection status
async function getConnectionStatus() {
  const tokenDoc = await QBToken.findOne().sort({ updatedAt: -1 });
  if (!tokenDoc) return { connected: false };
  return {
    connected: true,
    realmId: tokenDoc.realmId,
    accessTokenValid: tokenDoc.accessTokenExpiresAt > new Date(),
    refreshTokenValid: tokenDoc.refreshTokenExpiresAt > new Date(),
    connectedAt: tokenDoc.createdAt,
  };
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getValidToken,
  qbRequest,
  getConnectionStatus,
  getBaseUrl,
  getPaymentsBaseUrl,
};
