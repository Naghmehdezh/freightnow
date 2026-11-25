// No SMTP provider is configured in this repo yet, so delivery is mocked —
// same convention as the carrier adapters and the FedEx PIN flow.
function sendOtpEmail(user, code) {
  console.log(`[DEV EMAIL] To: ${user.email} — Your IFF Cargo verification code is: ${code} (expires in 10 min)`);
}

// IFF's quoting inbox for spot-rate requests (FTL / air / ocean).
function spotRateInbox() {
  return process.env.SPOT_RATE_NOTIFY_EMAIL || 'quotes@iffcargo.com';
}

function route(r) {
  const end = (city, port, country) => [port || city, country].filter(Boolean).join(', ');
  return `${end(r.originCity, r.originPort, r.originCountry)} → ${end(r.destCity, r.destPort, r.destCountry)}`;
}

function sendSpotRateRequestNotice(request, customer) {
  console.log(`[DEV EMAIL] To: ${spotRateInbox()} — New ${request.shipmentType.toUpperCase()} spot-rate request ${request.requestNumber} from ${customer?.email || 'a customer'}: ${route(request)}${request.weight ? `, ${request.weight} ${request.weightUnit || 'lb'}` : ''}${request.oceanType ? `, ${request.oceanType}` : ''}${request.airService ? `, ${request.airService}` : ''}. Price it in the portal under IFF Admin → Spot rates.`);
}

function sendSpotRateQuotedNotice(request, customer) {
  const price = `${request.quotedCurrency === 'USD' ? 'US$' : 'C$'}${request.quotedRate.toFixed(2)} ${request.quotedCurrency}`;
  console.log(`[DEV EMAIL] To: ${customer.email} — Your spot rate ${request.requestNumber} (${route(request)}) is ready: ${price}, valid until ${request.validUntil.toLocaleDateString('en-CA')}. Book it under Spot-rate requests in the portal.`);
}

function sendSpotRateDeclinedNotice(request, customer) {
  console.log(`[DEV EMAIL] To: ${customer.email} — We can't offer a rate for spot-rate request ${request.requestNumber} (${route(request)}).${request.customerNote ? ` ${request.customerNote}` : ''}`);
}

function sendGuestQuoteNotice(request) {
  const mode = { air: 'Air', ocean: 'Ocean', land: 'Land' }[request.mode] || request.mode;
  console.log(`[DEV EMAIL] To: ${spotRateInbox()} — New guest quote request ${request.requestNumber} (${mode}${request.volume ? ` ${request.volume.toUpperCase()}` : ''}): ${request.origin} → ${request.destination}. Contact ${request.name}, ${request.email}, ${request.phone}. See IFF Admin → Guest requests.`);
}

function sendGuestQuoteReceipt(request) {
  console.log(`[DEV EMAIL] To: ${request.email} — Thanks ${request.name}, we received your quote request ${request.requestNumber} (${request.origin} → ${request.destination}). An IFF representative will contact you shortly.`);
}

function sendGuestQuotePrice(request) {
  const price = `${request.quotedCurrency === 'USD' ? 'US$' : 'C$'}${request.quotedRate.toFixed(2)} ${request.quotedCurrency}`;
  console.log(`[DEV EMAIL] To: ${request.email} — Your IFF quote ${request.requestNumber} (${request.origin} → ${request.destination}): ${price}${request.serviceName ? `, ${request.serviceName}` : ''}${request.transitDays != null ? `, about ${request.transitDays} days in transit` : ''}, valid until ${request.validUntil.toLocaleDateString('en-CA')}.${request.customerNote ? ` ${request.customerNote}` : ''} Reply to this email or call 416 798 4151 to book.`);
}

function sendGuestQuoteDeclined(request) {
  console.log(`[DEV EMAIL] To: ${request.email} — About your quote request ${request.requestNumber} (${request.origin} → ${request.destination}): unfortunately we can't offer a rate for this shipment.${request.customerNote ? ` ${request.customerNote}` : ''}`);
}

// ─── Price adjustments (carrier re-weigh / re-measure) ───────────────
const money = (n, cur) => `${cur === 'USD' ? 'US$' : 'C$'}${Number(n).toFixed(2)} ${cur}`;

function sendAdjustmentNotice(adj, booking, customer, company) {
  const how = company?.paymentTerms === 'monthly'
    ? 'It has been added to your account as an invoice.'
    : 'Pay it in the IFF portal under Billing → Balance due.';
  console.log(`[DEV EMAIL] To: ${customer?.email} — Price adjustment ${adj.adjustmentNumber} for booking ${booking?.bookingNumber}: the carrier found a difference in your shipment (${adj.reason.replace('_', ' ')}). New price ${money(adj.newPrice, adj.currency)} vs ${money(adj.originalPrice, adj.currency)} quoted${adj.adminFee ? `, plus a ${money(adj.adminFee, adj.currency)} adjustment fee` : ''}. Balance due: ${money(adj.amountDue, adj.currency)} by ${adj.dueDate?.toLocaleDateString('en-CA')}. ${how} If you disagree, you can dispute it in the portal.`);
}

function sendAdjustmentCredit(adj, booking, customer) {
  const what = adj.status === 'refunded' ? `refunded to your card` : 'added to your account as store credit, used automatically on your next booking';
  console.log(`[DEV EMAIL] To: ${customer?.email} — Good news on booking ${booking?.bookingNumber}: the carrier charged less than quoted. ${money(adj.creditAmount, adj.currency)} has been ${what} (${adj.adjustmentNumber}).`);
}

function sendAdjustmentReceipt(adj) {
  console.log(`[DEV EMAIL] To: customer of ${adj.adjustmentNumber} — Thank you, we received ${money(adj.amountDue, adj.currency)} for price adjustment ${adj.adjustmentNumber}.`);
}

function sendAdjustmentDisputeNotice(adj) {
  console.log(`[DEV EMAIL] To: ${spotRateInbox()} — Price adjustment ${adj.adjustmentNumber} was disputed by the customer: "${adj.disputeReason}". See IFF Admin → Adjustments.`);
}

// ─── "Pay with QuickBooks link" bookings ────────────────────────────
function sendPaymentLink(booking, user, link, payBy, amount, currency) {
  console.log(`[DEV EMAIL] To: ${user?.email} — Your IFF booking ${booking.bookingNumber} is reserved. Pay ${money(amount, currency)} here: ${link || '(link unavailable — pay in the portal)'} by ${payBy.toLocaleString('en-CA')}. We book the carrier as soon as it's paid; unpaid reservations are cancelled after 24 hours.`);
}

function sendLinkPaymentReceived(booking, user, result) {
  console.log(`[DEV EMAIL] To: ${user?.email} — Payment received for booking ${booking.bookingNumber}. Your shipment is booked with ${booking.carrierName}${result?.carrierTrackingNumber ? ` (tracking ${result.carrierTrackingNumber})` : ''}${result?.pickup?.scheduled ? `, pickup confirmed (${result.pickup.confirmationNumber})` : ''}.`);
}

function sendLinkBookingCancelled(booking, user, reason) {
  console.log(`[DEV EMAIL] To: ${user?.email} — Booking ${booking.bookingNumber} was cancelled because ${reason}. Nothing was charged. Get a new quote in the IFF portal to book again.`);
}

// ─── Monthly statements ─────────────────────────────────────────────
function sendStatementIssued(statement, company) {
  console.log(`[DEV EMAIL] To: ${company.name} accounts — Statement ${statement.statementNumber} for ${statement.period}: ${statement.lines.length} invoice(s), total C$${statement.totalCad.toFixed(2)}${statement.creditApplied ? ` less C$${statement.creditApplied.toFixed(2)} store credit` : ''}. Amount due C$${statement.amountDue.toFixed(2)} by ${statement.dueDate.toLocaleDateString('en-CA')}. View it in the IFF portal under Billing.`);
}

function sendStatementPayment(statement, amount) {
  console.log(`[DEV EMAIL] To: customer of ${statement.statementNumber} — Thank you, we received C$${amount.toFixed(2)} for statement ${statement.statementNumber}. ${statement.status === 'paid' ? 'It is now paid in full.' : `Remaining balance: C$${(statement.amountDue - statement.paidAmount).toFixed(2)}.`}`);
}

module.exports = { sendPaymentLink, sendLinkPaymentReceived, sendLinkBookingCancelled, sendStatementIssued, sendStatementPayment, sendAdjustmentNotice, sendAdjustmentCredit, sendAdjustmentReceipt, sendAdjustmentDisputeNotice, sendGuestQuotePrice, sendGuestQuoteDeclined, sendGuestQuoteNotice, sendGuestQuoteReceipt, sendOtpEmail, sendSpotRateRequestNotice, sendSpotRateQuotedNotice, sendSpotRateDeclinedNotice };
