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

module.exports = { sendGuestQuotePrice, sendGuestQuoteDeclined, sendGuestQuoteNotice, sendGuestQuoteReceipt, sendOtpEmail, sendSpotRateRequestNotice, sendSpotRateQuotedNotice, sendSpotRateDeclinedNotice };
