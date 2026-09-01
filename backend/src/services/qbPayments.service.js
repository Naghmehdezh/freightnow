const { qbRequest, getValidToken, getPaymentsBaseUrl } = require('./quickbooks.service');
const { quickbooks } = require('../config/env');
const Payment = require('../models/Payment');
const PaymentMethod = require('../models/PaymentMethod');

// Tokenize a credit card via QuickBooks Payments (called when user adds a card)
async function tokenizeCard(cardData) {
  const tokenDoc = await getValidToken();
  const baseUrl = getPaymentsBaseUrl();

  const res = await fetch(`${baseUrl}/quickbooks/v4/payments/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDoc.accessToken}`,
    },
    body: JSON.stringify({
      card: {
        number: cardData.number,
        expMonth: cardData.expMonth,
        expYear: cardData.expYear,
        cvc: cardData.cvc,
        name: cardData.name,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Card tokenization failed: ${err}`);
  }

  const data = await res.json();
  return data.value; // The token string
}

// Charge a tokenized card via QuickBooks Payments
async function chargeCard({ bookingId, companyId, userId, amount, currency, paymentMethodId }) {
  const paymentMethod = await PaymentMethod.findOne({ _id: paymentMethodId, company: companyId });
  if (!paymentMethod) throw new Error('Payment method not found');
  if (!paymentMethod.qbCardToken) throw new Error('Payment method has no QuickBooks card token');

  const tokenDoc = await getValidToken();
  const baseUrl = getPaymentsBaseUrl();

  // Create the charge
  const chargePayload = {
    amount: amount.toFixed(2),
    currency: currency || 'CAD',
    token: paymentMethod.qbCardToken,
    context: {
      mobile: false,
      isEcommerce: true,
    },
  };

  const res = await fetch(`${baseUrl}/quickbooks/v4/payments/charges`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenDoc.accessToken}`,
      'Request-Id': `booking-${bookingId}-${Date.now()}`,
    },
    body: JSON.stringify(chargePayload),
  });

  let responseData;
  try { responseData = await res.json(); } catch { responseData = {}; }

  // In sandbox mode, if charge fails, mock a successful payment
  if (quickbooks.environment === 'sandbox' && (!res.ok || responseData.status !== 'CAPTURED')) {
    console.log('[QB-PAYMENTS] Sandbox charge declined — mocking successful payment for dev');
    const payment = await Payment.create({
      booking: bookingId,
      user: userId,
      amount,
      currency: currency || 'CAD',
      qbTransactionId: `sandbox-mock-${Date.now()}`,
      status: 'succeeded',
    });
    return { payment, transactionId: payment.qbTransactionId };
  }

  // Record the payment attempt regardless of outcome
  const payment = await Payment.create({
    booking: bookingId,
    user: userId,
    amount,
    currency: currency || 'CAD',
    qbTransactionId: responseData.id || null,
    status: res.ok && responseData.status === 'CAPTURED' ? 'succeeded' : 'failed',
    failureReason: !res.ok ? (responseData.errors?.[0]?.message || 'Charge failed') : undefined,
  });

  if (!res.ok || responseData.status !== 'CAPTURED') {
    const reason = responseData.errors?.[0]?.message || responseData.status || 'Payment declined';
    throw new Error(reason);
  }

  return { payment, transactionId: responseData.id };
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

module.exports = { tokenizeCard, chargeCard, refundCharge };
