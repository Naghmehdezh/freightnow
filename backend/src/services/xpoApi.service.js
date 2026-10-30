const https = require('https');
const zlib = require('zlib');

// XPO LTL has no separate sandbox host: everything goes to the production endpoints. Rating and
// tracking are read-only. The Bill of Lading API takes a mandatory testMode flag instead: with
// testMode=Y the BOL (and its pickup request) goes to XPO's test system and never reaches a
// service center, so no driver is dispatched. We send Y unless XPO_BOL_TEST_MODE=N.
const AUTH_URL = 'https://api.xpo.com/token';
const RATE_URL = 'https://api.ltl.xpo.com/rating/1.0/ratequotes';
const TRACKING_BASE = 'https://api.ltl.xpo.com/tracking/1.0';
const BOL_BASE = 'https://api.ltl.xpo.com/billoflading/1.0/billsoflading';

// Auth is an OAuth2 "password" grant: the Basic header carries the consumer key/secret
// (XPO_AUTH_KEY, already base64), the body carries the XPO LTL portal user. Rates are priced
// against XPO_BILL_ACCOUNT, which must be a Bill-To account linked to that user's profile.
// (XPO_PD_ACCOUNT is a pickup/delivery location account; XPO rejects it as a bill-to party.)
function isConfigured() {
  return !!(process.env.XPO_AUTH_KEY && process.env.XPO_USERNAME && process.env.XPO_PASSWORD
    && process.env.XPO_BILL_ACCOUNT);
}

const REQUEST_TIMEOUT_MS = 20000;
const BOL_TIMEOUT_MS = 45000; // creating a BOL with its pickup request can take longer

function _request(method, url, headers, rawBody, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyBuf = rawBody ? Buffer.from(rawBody) : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'User-Agent': 'IFFCargo/1.0',
        'Accept-Encoding': 'gzip, deflate, identity',
        Accept: 'application/json',
        ...headers,
        ...(bodyBuf && { 'Content-Length': bodyBuf.length }),
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
            console.error(`[XPO-HTTP] ${method} ${url} failed: ${res.statusCode}`, text.substring(0, 500));
            let parsed = text;
            try { parsed = JSON.parse(text); } catch { /* keep raw text */ }
            // XPO puts the useful reason in error.message, often with a trailing "|".
            const reason = parsed?.error?.message?.replace(/\|$/, '') || '';
            const err = new Error(`XPO API error (${res.statusCode})${reason ? `: ${reason}` : ''}`);
            err.statusCode = res.statusCode;
            err.body = parsed;
            reject(err);
          }
        }

        if (encoding === 'gzip') zlib.gunzip(buf, (e, d) => e ? reject(e) : handleBody(d.toString()));
        else if (encoding === 'deflate') zlib.inflate(buf, (e, d) => e ? reject(e) : handleBody(d.toString()));
        else handleBody(buf.toString());
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`XPO API request timed out after ${timeoutMs}ms`));
    });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Bearer token — cached until shortly before expires_in
// ---------------------------------------------------------------------------

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) return cachedToken;
  if (!isConfigured()) {
    throw new Error('XPO credentials not configured (XPO_AUTH_KEY / XPO_USERNAME / XPO_PASSWORD / XPO_BILL_ACCOUNT)');
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username: process.env.XPO_USERNAME,
    password: process.env.XPO_PASSWORD,
  }).toString();

  const data = await _request('POST', AUTH_URL, {
    Authorization: `Basic ${process.env.XPO_AUTH_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }, body);

  const token = data.access_token || data.accessToken;
  if (!token) throw new Error('XPO /token returned no access_token');

  cachedToken = token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

function clearToken() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function _authenticatedRequest(method, url, body, timeoutMs) {
  const send = async () => _request(method, url, {
    Authorization: `Bearer ${await getToken()}`,
    ...(body && { 'Content-Type': 'application/json' }),
  }, body ? JSON.stringify(body) : null, timeoutMs);

  try {
    return await send();
  } catch (err) {
    if (err.statusCode === 401) {
      clearToken();
      return send();
    }
    throw err;
  }
}

function rateQuote(body) {
  return _authenticatedRequest('POST', RATE_URL, body);
}

// getShipmentStatus: current status + estimated/final delivery dates for a PRO number.
function getShipmentStatus(pro) {
  return _authenticatedRequest('GET',
    `${TRACKING_BASE}/shipments/shipment-status-details?referenceNumbers=${encodeURIComponent(pro)}`);
}

// listShipmentTrackingEvents: full movement history for one PRO number.
function listTrackingEvents(pro) {
  return _authenticatedRequest('GET', `${TRACKING_BASE}/shipments/${encodeURIComponent(pro)}/tracking-events`);
}

// ---------------------------------------------------------------------------
// Bill of Lading (with pickup request) — see XPO_API_BOL_Guide.pdf
// ---------------------------------------------------------------------------

// Real BOLs only when explicitly switched on; anything else stays in XPO's test system.
function bolTestMode() {
  return (process.env.XPO_BOL_TEST_MODE || '').trim().toUpperCase() === 'N' ? 'N' : 'Y';
}

const bolUrl = (path = '') => `${BOL_BASE}${path}?testMode=${bolTestMode()}`;

// createBillOfLading: body is { bol: {...}, autoAssignPro }. With bol.pickupInfo, XPO also
// creates the pickup request. Returns data.bolInfo { bolInstId, pkupInstId, pkupTrmnlSic, ... }.
function createBol(body) {
  return _authenticatedRequest('POST', bolUrl(), body, BOL_TIMEOUT_MS);
}

// getBillOfLading: the stored BOL, including proNbr once XPO has assigned one.
function getBol(bolInstId) {
  return _authenticatedRequest('GET', bolUrl(`/${encodeURIComponent(bolInstId)}/requester`));
}

// cancelBillOfLading: cancels the BOL and its pickup request.
function cancelBol(bolInstId) {
  return _authenticatedRequest('PUT', bolUrl(`/${encodeURIComponent(bolInstId)}/cancel`), { bolInstId: String(bolInstId) });
}

// getBillOfLadingPdf: data.bolpdf { fileName, contentType (the PDF, base64) }.
function getBolPdf(bolInstId) {
  return _authenticatedRequest('GET', bolUrl(`/${encodeURIComponent(bolInstId)}/pdf`));
}

module.exports = {
  isConfigured, getToken, clearToken, rateQuote, getShipmentStatus, listTrackingEvents,
  bolTestMode, createBol, getBol, cancelBol, getBolPdf,
};
