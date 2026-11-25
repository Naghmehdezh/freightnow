const { getValidToken, getPaymentsBaseUrl, ENVIRONMENT } = require('./quickbooks.service');
const { convert } = require('../utils/currency');

// Card payments without storing cards: the customer's browser sends the card straight to
// QuickBooks Payments (POST /quickbooks/v4/payments/tokens, no IFF credentials needed) and gets
// a one-time token. The server only ever sees that token and charges it once, here.

// Charge a one-time card token. Returns the QuickBooks charge; throws with the decline reason.
async function chargeToken({ token, amount, currency, requestId, usdToCad }) {
  currency = currency || 'CAD';
  // Sandbox only: a US test company can't take CAD (and a Canadian one can't take USD), so the
  // test charge is made for the same amount in the test company's currency. The booking still
  // records the price in the customer's currency. Live charges are never converted.
  if (ENVIRONMENT === 'sandbox') {
    const home = await require('./qbInvoices.service').homeCurrency().catch(() => currency);
    if (home !== currency) {
      console.log(`[QB SANDBOX] Test company bills in ${home}: charging ${convert(amount, currency, home, usdToCad)} ${home} for ${Number(amount).toFixed(2)} ${currency}`);
      amount = convert(amount, currency, home, usdToCad);
      currency = home;
    }
  }
  const tokenDoc = await getValidToken();
  const res = await fetch(`${getPaymentsBaseUrl()}/quickbooks/v4/payments/charges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDoc.accessToken}`,
      // Same Request-Id = same charge: QuickBooks won't charge twice if a request is retried.
      'Request-Id': requestId,
    },
    body: JSON.stringify({
      amount: Number(amount).toFixed(2),
      currency,
      token,
      context: { mobile: false, isEcommerce: true },
    }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok || data.status !== 'CAPTURED') {
    // QuickBooks puts the field name in "message" ("token") and the explanation in "detail".
    const e = data.errors?.[0];
    let reason = (e && (/\s/.test(e.message || '') ? e.message : e.detail || e.message)) || data.status || `HTTP ${res.status}`;
    if (/card is invalid|card type/i.test(reason)) reason = 'the card number was not accepted. Please check it';
    // The connected QuickBooks company can't take this currency (e.g. a US company and a CAD rate).
    if (/currency is invalid/i.test(reason)) reason = `the connected QuickBooks company doesn't accept ${currency} card payments`;
    const err = new Error(reason);
    err.declined = true;
    throw err;
  }
  return data; // { id, status: 'CAPTURED', amount, currency, card: { number: 'xxxx1111', cardType }, ... }
}

// Refund a charge
async function refundCharge(qbTransactionId, amount) {
  const tokenDoc = await getValidToken();
  const baseUrl = getPaymentsBaseUrl();

  const res = await fetch(`${baseUrl}/quickbooks/v4/payments/charges/${qbTransactionId}/refunds`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDoc.accessToken}`,
      'Request-Id': `refund-${qbTransactionId}-${Date.now()}`,
    },
    body: JSON.stringify({ amount: amount.toFixed(2) }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Refund failed: ${err}`);
  }

  return res.json();
}

module.exports = { chargeToken, refundCharge };
