// CAD <-> USD at a given USD->CAD rate (the pricing rule set's usdToCadRate, locked per quote).
// Customers see and pay in the currency they choose; the carrier's own currency is kept for cost
// and margin.
const round2 = n => Math.round(n * 100) / 100;

function convert(amount, from, to, usdToCad) {
  const a = Number(amount) || 0;
  if (!from || !to || from === to) return round2(a);
  const fx = Number(usdToCad) || 1.4;
  return from === 'USD' ? round2(a * fx) : round2(a / fx);
}

// { CAD, USD } for one price.
function bothCurrencies(amount, currency, usdToCad) {
  return { CAD: convert(amount, currency, 'CAD', usdToCad), USD: convert(amount, currency, 'USD', usdToCad) };
}

module.exports = { convert, bothCurrencies };
