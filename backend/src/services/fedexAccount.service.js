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
// FedEx Credential Registration API — POST /irc/v1/customerkeys
//
// Per the FedEx test case baseline (MFA sheet), this is a multi-step API.
// All steps POST to the same endpoint, but with different request bodies:
//
//   1. Address Validation (Factor 1):
//      Request:  { accountNumber: { value }, address, customerName }
//      Response: { output: { customerKey, customerPassword } }  (passthrough)
//              or MFA required (no credentials returned)
//
//   2. Pin Generation (Factor 2 — trigger):
//      Request:  { option: "EMAIL"|"SMS"|"CALL", locale: "en_CA" }
//
//   3. Pin Validation (Factor 2 — verify PIN):
//      Request:  { secureCodePin: "123456", customerName }
//      Response: { output: { customerKey, customerPassword } }
//
//   4. Invoice Validation (Factor 2 — verify invoice):
//      Request:  { invoiceDetail: { number, date, currency, amount }, customerName, locale }
//      Response: { output: { customerKey, customerPassword } }
//
// In mock mode (no FEDEX_API_KEY), we simulate the multi-step MFA flow with
// local PIN generation and invoice validation so the UI can be fully tested.
// ---------------------------------------------------------------------------

const FACTOR2_METHOD_MAP = {
  pin_email: 'EMAIL',
  pin_sms: 'SMS',
  pin_call: 'CALL',
};

async function _fedexRegistrationCall(body) {
  const token = await getToken();
  const url = `${getBaseUrl()}/irc/v1/customerkeys`;
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-locale': 'en_CA',
  };
  const bodyStr = JSON.stringify(body);

  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      data = await httpsPost(url, bodyStr, headers);
      break;
    } catch (err) {
      if ((err.message.includes('401') || err.message.includes('503')) && attempt < 2) {
        console.log(`[FEDEX-REG] Attempt ${attempt + 1} failed (${err.message}), retrying...`);
        if (err.message.includes('401')) {
          invalidateToken();
          const freshToken = await getToken();
          headers.Authorization = `Bearer ${freshToken}`;
        }
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  return data;
}

function _buildFedexAddress(address) {
  return {
    streetLines: Array.isArray(address.street) ? address.street : [address.street || ''],
    city: address.city || '',
    stateOrProvinceCode: address.province || '',
    postalCode: address.postalCode || '',
    countryCode: address.country || 'CA',
    residential: false,
  };
}

// ---------------------------------------------------------------------------
// startConnection — Factor 1 (Address Validation)
//
// Sends { accountNumber: { value }, address, customerName } to FedEx.
// If FedEx returns customerKey/customerPassword (passthrough account), done.
// Otherwise, MFA is required — connection stays in awaiting_factor2.
// ---------------------------------------------------------------------------

async function startConnection(userId, { fedexAccountNumber, address, eulaAccepted, customerName }) {
  if (!eulaAccepted) {
    throw new ValidationError('You must accept the FedEx EULA before connecting a FedEx account.');
  }

  if (isLive) {
    try {
      return await _liveStartConnection(userId, { fedexAccountNumber, address, customerName });
    } catch (err) {
      console.error('[FEDEX-REG] Live startConnection failed, falling back to mock:', err.message);
      return _mockStartConnection(userId, { fedexAccountNumber, address, customerName });
    }
  }
  return _mockStartConnection(userId, { fedexAccountNumber, address, customerName });
}

async function _liveStartConnection(userId, { fedexAccountNumber, address, customerName }) {
  const body = {
    accountNumber: { value: fedexAccountNumber },
    address: _buildFedexAddress(address),
    customerName: customerName || 'Customer',
  };

  const data = await _fedexRegistrationCall(body);

  // MFA passthrough — FedEx returned credentials directly
  if (data.output?.customerKey) {
    const connection = await FedexAccountConnection.create({
      user: userId,
      fedexAccountNumber,
      customerName: body.customerName,
      shippingAddress: address,
      eulaAcceptedAt: new Date(),
      status: 'verified',
      verifiedAt: new Date(),
      childKey: data.output.customerKey,
      childSecret: data.output.customerPassword,
      customerServiceBypass: true,
    });
    activityLogService.logActivity(userId, null, 'fedex_eula_accepted', { connectionId: connection.id });
    activityLogService.logActivity(userId, null, 'fedex_account_verified', { connectionId: connection.id });
    return sanitize(connection);
  }

  // MFA required — store connection, await Factor 2
  const connection = await FedexAccountConnection.create({
    user: userId,
    fedexAccountNumber,
    customerName: body.customerName,
    shippingAddress: address,
    eulaAcceptedAt: new Date(),
    status: 'awaiting_factor2',
    availablePinDeliveryOptions: ['EMAIL', 'SMS', 'CALL'],
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
// startFactor2 — trigger PIN delivery or select invoice method
//
// For PIN methods: sends { option: "EMAIL"|"SMS"|"CALL", locale } to FedEx.
// FedEx delivers the PIN to the customer's contact info on file.
// For invoice: just updates DB record (invoice details sent during verification).
// ---------------------------------------------------------------------------

async function startFactor2(userId, connectionId, method) {
  const connection = await getOwnedConnection(userId, connectionId);
  assertNotLocked(connection);

  if (isLive) {
    try {
      return await _liveStartFactor2(connection, method);
    } catch (err) {
      console.error('[FEDEX-REG] Live startFactor2 failed, falling back to mock:', err.message);
      return _mockStartFactor2(connection, method);
    }
  }
  return _mockStartFactor2(connection, method);
}

async function _liveStartFactor2(connection, method) {
  if (method === 'invoice') {
    connection.factor2Method = method;
    await connection.save();
    return sanitize(connection);
  }

  // PIN methods — tell FedEx to deliver the PIN
  const fedexOption = FACTOR2_METHOD_MAP[method];
  const body = {
    option: fedexOption,
    locale: 'en_CA',
  };

  await _fedexRegistrationCall(body);

  connection.factor2Method = method;
  connection.attempts = 0;
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
// verifyPin — submit PIN to FedEx for validation
//
// Sends { secureCodePin, customerName } to FedEx.
// On success, FedEx returns customerKey/customerPassword.
// ---------------------------------------------------------------------------

async function verifyPin(userId, connectionId, code) {
  const connection = await getOwnedConnection(userId, connectionId);
  assertNotLocked(connection);

  if (isLive) {
    return _liveVerifyPin(connection, code);
  }
  return _mockVerifyPin(connection, code);
}

async function _liveVerifyPin(connection, code) {
  const body = {
    secureCodePin: code,
    customerName: connection.customerName || 'Customer',
  };

  try {
    const data = await _fedexRegistrationCall(body);

    if (data.output?.customerKey) {
      connection.status = 'verified';
      connection.verifiedAt = new Date();
      connection.childKey = data.output.customerKey;
      connection.childSecret = data.output.customerPassword;
      connection.pinCodeHash = null;
      connection.pinExpiresAt = null;
      await connection.save();
      return sanitize(connection);
    }

    // FedEx did not return credentials — PIN may have been wrong
    return recordFailedAttempt(connection, "That code didn't match.");
  } catch (err) {
    return recordFailedAttempt(connection, err.message || "That code didn't match.");
  }
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
// verifyInvoice — submit invoice to FedEx for validation
//
// Sends { invoiceDetail: { number, date, currency, amount }, customerName, locale }
// to FedEx. On success, FedEx returns customerKey/customerPassword.
// ---------------------------------------------------------------------------

async function verifyInvoice(userId, connectionId, { invoiceNumber, invoiceDate, amount, currency }) {
  const connection = await getOwnedConnection(userId, connectionId);
  assertNotLocked(connection);

  if (isLive) {
    return _liveVerifyInvoice(connection, { invoiceNumber, invoiceDate, amount, currency });
  }
  return _mockVerifyInvoice(connection, { invoiceNumber, invoiceDate, amount, currency });
}

async function _liveVerifyInvoice(connection, { invoiceNumber, invoiceDate, amount, currency }) {
  const body = {
    invoiceDetail: {
      number: invoiceNumber,
      date: invoiceDate,
      currency: currency || 'USD',
      amount: String(amount),
    },
    customerName: connection.customerName || 'Customer',
    locale: 'en_CA',
  };

  try {
    const data = await _fedexRegistrationCall(body);

    if (data.output?.customerKey) {
      connection.status = 'verified';
      connection.verifiedAt = new Date();
      connection.childKey = data.output.customerKey;
      connection.childSecret = data.output.customerPassword;
      await connection.save();
      return sanitize(connection);
    }

    return recordFailedAttempt(connection, "Invoice doesn't exist for the provided details.");
  } catch (err) {
    return recordFailedAttempt(connection, err.message || "Invoice doesn't exist for the provided details.");
  }
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
  const { pinCodeHash, childSecret, ...rest } = obj;
  return { ...rest, hasChildSecret: !!childSecret };
}

module.exports = { startConnection, startFactor2, verifyPin, verifyInvoice, listConnections, disconnect };
