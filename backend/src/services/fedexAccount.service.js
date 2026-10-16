const crypto = require('crypto');
const bcrypt = require('bcrypt');
const FedexAccountConnection = require('../models/FedexAccountConnection');
const config = require('../config/env');
const activityLogService = require('./activityLog.service');
const { ValidationError, NotFoundError, AuthenticationError } = require('../utils/errors');
const { getToken, getBaseUrl, httpsPost, invalidateToken } = require('./fedexAuth.service');

const PIN_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const LOCKOUT_HOURS = 24;
const INVOICE_MAX_AGE_DAYS = 90;
const LOCKED_MESSAGE = 'We are unable to process this request. Please try again later or call FedEx Customer Service and ask for technical support.';

const isLive = !!process.env.FEDEX_API_KEY;

// ---------------------------------------------------------------------------
// FedEx Account Registration API (v2)
//
// Endpoints confirmed against the FedEx sandbox and the Integrator test case baseline
// (MFA tab). The old single endpoint POST /irc/v1/customerkeys returns 403 for this project.
//
//   Factor 1  POST /registration/v2/address/keysgeneration
//             { accountNumber: { value }, customerName, address }
//             -> output.mfaOptions[0] = { accountAuthToken, mfaRequired, phoneNumber,
//                                         options: { invoice: 'INVOICE', secureCode: ['SMS','EMAIL','CALL'] } }
//             (an MFA-passthrough account returns output.credentials { child_Key, child_secret } here directly)
//   Factor 2  POST /registration/v2/customerkeys/pingeneration  { option, locale }
//             POST /registration/v2/pin/keysgeneration          { secureCodePin, customerName }
//             POST /registration/v2/invoice/keysgeneration      { invoiceDetail, customerName, locale }
//             -> output.child_Key / output.child_secret
//
// Every call uses the project's OAuth token as the Bearer; Factor 2 calls ALSO send the
// Factor 1 accountAuthToken in a header of that name (sending it as the Bearer gives 401).
// FedEx matches the address strictly: street on one line, and the full ZIP+4 for US accounts.
//
// Live failures are surfaced to the user as FedEx's own message — never silently replaced
// with simulated data, which would make a failed registration look successful.
// Mock mode (local PIN, simulated keys) is used only when no FEDEX_API_KEY is configured.
// ---------------------------------------------------------------------------

const FACTOR2_METHOD_MAP = {
  pin_email: 'EMAIL',
  pin_sms: 'SMS',
  pin_call: 'CALL',
};
const LOCALE = 'en_US';
const ACCOUNT_AUTH_TOKEN_FALLBACK_MINUTES = 30;

function fedexErrorMessage(err, fallback) {
  const codes = err?.body?.errors;
  if (Array.isArray(codes) && codes.length) {
    const e = codes[0];
    if (e.code === 'ACCOUNT.ADDRESS.MISMATCH') {
      return 'The address does not match the one FedEx has on file for this account. Enter it exactly as it appears on your FedEx invoice (US accounts: use the full ZIP+4).';
    }
    return e.message || fallback;
  }
  return fallback;
}

async function _registrationCall(path, body, accountAuthToken) {
  const headers = {
    Authorization: `Bearer ${await getToken()}`,
    'Content-Type': 'application/json',
    'X-locale': LOCALE,
    ...(accountAuthToken && { accountAuthToken }),
  };
  const bodyStr = JSON.stringify(body);
  for (let attempt = 0; ; attempt++) {
    try {
      return await httpsPost(`${getBaseUrl()}${path}`, bodyStr, headers);
    } catch (err) {
      const retryable = (err.statusCode === 401 || err.statusCode === 503) && attempt < 2;
      if (!retryable) throw err;
      console.log(`[FEDEX-REG] ${path} attempt ${attempt + 1} failed (${err.statusCode}), retrying...`);
      if (err.statusCode === 401 && !accountAuthToken) {
        invalidateToken();
        headers.Authorization = `Bearer ${await getToken()}`;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function _buildFedexAddress(address) {
  return {
    // One line: FedEx answers ACCOUNT.ADDRESS.MISMATCH when the street is split across lines.
    streetLines: [String(address.street || '').trim()],
    city: (address.city || '').trim(),
    stateOrProvinceCode: (address.province || '').trim().toUpperCase(),
    postalCode: String(address.postalCode || '').replace(/[\s-]/g, '').toUpperCase(),
    countryCode: address.country || 'CA',
    residential: false,
  };
}

function _childKeys(output = {}) {
  // MFA-passthrough accounts return the keys under output.credentials at Factor 1.
  if (output.credentials) output = output.credentials;
  return {
    key: output.child_Key || output.childKey || output.child_key || output.customerKey,
    secret: output.child_secret || output.childSecret || output.child_Secret || output.customerPassword,
  };
}

function _tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    if (payload.exp) return new Date(payload.exp * 1000);
  } catch { /* fall through */ }
  return new Date(Date.now() + ACCOUNT_AUTH_TOKEN_FALLBACK_MINUTES * 60 * 1000);
}

function _requireAccountAuthToken(connection) {
  if (!connection.accountAuthToken || !connection.accountAuthTokenExpiresAt
    || connection.accountAuthTokenExpiresAt < new Date()) {
    throw new ValidationError('This verification session has expired. Please start the FedEx account connection again.');
  }
  return connection.accountAuthToken;
}

async function _markVerified(connection, output) {
  const { key, secret } = _childKeys(output);
  connection.status = 'verified';
  connection.verifiedAt = new Date();
  connection.childKey = key;
  connection.childSecret = secret;
  connection.pinCodeHash = null;
  connection.pinExpiresAt = null;
  connection.accountAuthToken = undefined;
  connection.accountAuthTokenExpiresAt = undefined;
  await connection.save();
  activityLogService.logActivity(connection.user, null, 'fedex_account_verified', {
    connectionId: connection.id, method: connection.factor2Method || 'passthrough',
  });
  return sanitize(connection);
}

// ---------------------------------------------------------------------------
// startConnection — Factor 1 (address validation)
// ---------------------------------------------------------------------------

async function startConnection(userId, { fedexAccountNumber, address, eulaAccepted, customerName }) {
  if (!eulaAccepted) {
    throw new ValidationError('You must accept the FedEx EULA before connecting a FedEx account.');
  }
  return isLive
    ? _liveStartConnection(userId, { fedexAccountNumber, address, customerName })
    : _mockStartConnection(userId, { fedexAccountNumber, address, customerName });
}

async function _liveStartConnection(userId, { fedexAccountNumber, address, customerName }) {
  const body = {
    accountNumber: { value: fedexAccountNumber },
    customerName: customerName || 'Customer',
    address: _buildFedexAddress(address),
  };

  let data;
  try {
    data = await _registrationCall('/registration/v2/address/keysgeneration', body);
  } catch (err) {
    console.error('[FEDEX-REG] Address validation failed:', err.message, err.body?.transactionId || '');
    throw new ValidationError(fedexErrorMessage(err, 'FedEx could not validate this account and address.'));
  }

  const output = data.output || {};
  const mfa = output.mfaOptions?.[0] || {};
  const base = {
    user: userId,
    fedexAccountNumber,
    customerName: body.customerName,
    shippingAddress: address,
    eulaAcceptedAt: new Date(),
  };

  // MFA passthrough account — FedEx issues the child keys at Factor 1.
  if (_childKeys(output).key || mfa.mfaRequired === false) {
    const connection = await FedexAccountConnection.create({ ...base, status: 'awaiting_factor2', customerServiceBypass: true });
    activityLogService.logActivity(userId, null, 'fedex_eula_accepted', { connectionId: connection.id });
    return _markVerified(connection, _childKeys(output).key ? output : mfa);
  }

  if (!mfa.accountAuthToken) {
    throw new ValidationError('FedEx did not return verification options for this account. Please contact FedEx Customer Service.');
  }

  const connection = await FedexAccountConnection.create({
    ...base,
    status: 'awaiting_factor2',
    availablePinDeliveryOptions: mfa.options?.secureCode || [],
    invoiceOptionAvailable: !!mfa.options?.invoice,
    maskedPhoneNumber: mfa.phoneNumber || undefined,
    accountAuthToken: mfa.accountAuthToken,
    accountAuthTokenExpiresAt: _tokenExpiry(mfa.accountAuthToken),
  });
  activityLogService.logActivity(userId, null, 'fedex_eula_accepted', { connectionId: connection.id });
  return sanitize(connection);
}

async function _mockStartConnection(userId, { fedexAccountNumber, address, customerName }) {
  const connection = await FedexAccountConnection.create({
    user: userId,
    fedexAccountNumber,
    customerName: customerName || 'Customer',
    shippingAddress: address,
    eulaAcceptedAt: new Date(),
    status: 'awaiting_factor2',
    availablePinDeliveryOptions: ['EMAIL', 'SMS', 'CALL'],
  });

  activityLogService.logActivity(userId, null, 'fedex_eula_accepted', { connectionId: connection.id });
  return sanitize(connection);
}

// ---------------------------------------------------------------------------
// startFactor2 — PIN generation (EMAIL / SMS / CALL), or choose invoice
// ---------------------------------------------------------------------------

async function startFactor2(userId, connectionId, method) {
  const connection = await getOwnedConnection(userId, connectionId);
  assertNotLocked(connection);
  return isLive ? _liveStartFactor2(connection, method) : _mockStartFactor2(connection, method);
}

async function _liveStartFactor2(connection, method) {
  const accountAuthToken = _requireAccountAuthToken(connection);
  if (method !== 'invoice') {
    try {
      await _registrationCall('/registration/v2/customerkeys/pingeneration',
        { option: FACTOR2_METHOD_MAP[method], locale: LOCALE }, accountAuthToken);
    } catch (err) {
      console.error('[FEDEX-REG] PIN generation failed:', err.message, err.body?.transactionId || '');
      throw new ValidationError(fedexErrorMessage(err, 'FedEx could not send a verification code. Please try another method.'));
    }
    connection.attempts = 0;
  }
  connection.factor2Method = method;
  await connection.save();
  return sanitize(connection);
}

async function _mockStartFactor2(connection, method) {
  if (method === 'invoice') {
    connection.factor2Method = method;
    await connection.save();
    return sanitize(connection);
  }

  // Mock PIN generation (local)
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const pinCodeHash = await bcrypt.hash(code, config.bcryptRounds);
  const pinExpiresAt = new Date(Date.now() + PIN_EXPIRY_MINUTES * 60 * 1000);

  console.log(`[DEV FEDEX PIN] connection ${connection.id} via ${method}: ${code} (expires in ${PIN_EXPIRY_MINUTES} min)`);

  connection.factor2Method = method;
  connection.pinCodeHash = pinCodeHash;
  connection.pinExpiresAt = pinExpiresAt;
  connection.attempts = 0;
  await connection.save();

  return sanitize(connection);
}

// ---------------------------------------------------------------------------
// verifyPin — PIN validation
// ---------------------------------------------------------------------------

async function verifyPin(userId, connectionId, code) {
  const connection = await getOwnedConnection(userId, connectionId);
  assertNotLocked(connection);
  return isLive ? _liveVerifyPin(connection, code) : _mockVerifyPin(connection, code);
}

async function _liveVerifyPin(connection, code) {
  const accountAuthToken = _requireAccountAuthToken(connection);
  let data;
  try {
    data = await _registrationCall('/registration/v2/pin/keysgeneration',
      { secureCodePin: code, customerName: connection.customerName || 'Customer' }, accountAuthToken);
  } catch (err) {
    console.error('[FEDEX-REG] PIN validation failed:', err.message, err.body?.transactionId || '');
    return recordFailedAttempt(connection, fedexErrorMessage(err, "That code didn't match."));
  }
  if (!_childKeys(data.output).key) return recordFailedAttempt(connection, "That code didn't match.");
  return _markVerified(connection, data.output);
}

async function _mockVerifyPin(connection, code) {
  if (!connection.pinCodeHash || !connection.pinExpiresAt || connection.pinExpiresAt < new Date()) {
    throw new AuthenticationError('This code has expired. Please request a new one.');
  }

  const valid = await bcrypt.compare(code, connection.pinCodeHash);
  if (!valid) {
    return recordFailedAttempt(connection, "That code didn't match.");
  }

  return _mockFinalizeVerification(connection);
}

// ---------------------------------------------------------------------------
// verifyInvoice — invoice validation
// ---------------------------------------------------------------------------

async function verifyInvoice(userId, connectionId, { invoiceNumber, invoiceDate, amount, currency }) {
  const connection = await getOwnedConnection(userId, connectionId);
  assertNotLocked(connection);
  return isLive
    ? _liveVerifyInvoice(connection, { invoiceNumber, invoiceDate, amount, currency })
    : _mockVerifyInvoice(connection, { invoiceNumber, invoiceDate, amount, currency });
}

async function _liveVerifyInvoice(connection, { invoiceNumber, invoiceDate, amount, currency }) {
  const accountAuthToken = _requireAccountAuthToken(connection);
  const body = {
    invoiceDetail: {
      number: String(invoiceNumber).trim(),
      date: invoiceDate,
      currency: currency || 'USD',
      amount: Number(amount).toFixed(2),
    },
    customerName: connection.customerName || 'Customer',
    locale: LOCALE,
  };
  let data;
  try {
    data = await _registrationCall('/registration/v2/invoice/keysgeneration', body, accountAuthToken);
  } catch (err) {
    console.error('[FEDEX-REG] Invoice validation failed:', err.message, err.body?.transactionId || '');
    return recordFailedAttempt(connection, fedexErrorMessage(err, "Invoice doesn't exist for the provided details."));
  }
  connection.factor2Method = 'invoice';
  if (!_childKeys(data.output).key) return recordFailedAttempt(connection, "Invoice doesn't exist for the provided details.");
  return _markVerified(connection, data.output);
}

async function _mockVerifyInvoice(connection, { invoiceNumber, invoiceDate, amount, currency }) {
  const ageMs = Date.now() - new Date(invoiceDate).getTime();
  const isValid = invoiceNumber?.trim() && amount > 0 && currency?.trim()
    && ageMs >= 0 && ageMs <= INVOICE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  if (!isValid) {
    return recordFailedAttempt(connection, "Invoice doesn't exist for the provided details.");
  }

  return _mockFinalizeVerification(connection);
}

// ---------------------------------------------------------------------------
// List and disconnect
// ---------------------------------------------------------------------------

async function listConnections(userId) {
  const connections = await FedexAccountConnection.find({ user: userId }).sort({ createdAt: -1 });
  return connections.map(sanitize);
}

async function disconnect(userId, connectionId) {
  const connection = await getOwnedConnection(userId, connectionId);
  await FedexAccountConnection.deleteOne({ _id: connection._id });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getOwnedConnection(userId, connectionId) {
  const connection = await FedexAccountConnection.findOne({ _id: connectionId, user: userId });
  if (!connection) throw new NotFoundError('FedEx account connection');
  return connection;
}

function assertNotLocked(connection) {
  if (connection.status === 'locked' && connection.lockedUntil && connection.lockedUntil > new Date()) {
    throw new AuthenticationError(LOCKED_MESSAGE);
  }
}

async function recordFailedAttempt(connection, reasonMessage) {
  connection.attempts += 1;

  if (connection.attempts >= MAX_ATTEMPTS) {
    connection.status = 'locked';
    connection.lockedUntil = new Date(Date.now() + LOCKOUT_HOURS * 60 * 60 * 1000);
    await connection.save();
    const err = new AuthenticationError(LOCKED_MESSAGE);
    err.details = { connection: sanitize(connection) };
    throw err;
  }

  await connection.save();
  const err = new AuthenticationError(`${reasonMessage} ${MAX_ATTEMPTS - connection.attempts} attempt(s) remaining.`);
  err.details = { connection: sanitize(connection) };
  throw err;
}

async function _mockFinalizeVerification(connection) {
  connection.status = 'verified';
  connection.verifiedAt = new Date();
  connection.childKey = `child_${crypto.randomBytes(12).toString('hex')}`;
  connection.childSecret = crypto.randomBytes(24).toString('hex');
  connection.pinCodeHash = null;
  connection.pinExpiresAt = null;
  await connection.save();

  return sanitize(connection);
}

function sanitize(connection) {
  const obj = connection.toObject({ virtuals: true });
  const { pinCodeHash, childSecret, accountAuthToken, ...rest } = obj;
  return { ...rest, hasChildSecret: !!childSecret };
}

module.exports = { startConnection, startFactor2, verifyPin, verifyInvoice, listConnections, disconnect };
