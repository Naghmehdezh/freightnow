// Card payments without IFF ever touching the card: the browser sends it straight to QuickBooks
// Payments and gets a one-time token; only that token goes to IFF's server, which charges it once.
// Shared by the booking form and "Pay balance" (price adjustments).

export const emptyCard = (postalCode = '') => ({ name: '', number: '', expiry: '', cvc: '', postalCode: String(postalCode).replace(/\s/g, '') });

// Expiry as typed: "0329", "03/29", "3/29" or "03/2029" -> { mm: '03', yyyy: '2029' }, or null.
export function parseExpiry(value) {
  const v = String(value).trim();
  let mm, yy;
  if (v.includes('/')) [mm, yy] = v.split('/').map(x => x.trim());
  else if (/^\d{4}$/.test(v) || /^\d{6}$/.test(v)) [mm, yy] = [v.slice(0, 2), v.slice(2)];
  else return null;
  if (!/^\d{1,2}$/.test(mm || '') || !/^(\d{2}|\d{4})$/.test(yy || '')) return null;
  const month = Number(mm);
  if (month < 1 || month > 12) return null;
  return { mm: String(month).padStart(2, '0'), yyyy: yy.length === 2 ? `20${yy}` : yy };
}

// Adds the slash while typing: "032" -> "03/2".
export function formatExpiry(v) {
  const d = v.replace(/[^\d/]/g, '');
  if (d.includes('/')) return d.slice(0, 7);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2, 4)}` : d;
}

// Luhn checksum: catches mistyped card numbers before they're sent anywhere.
function luhnValid(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// Error message for incomplete card details, or null when they look complete.
export function cardProblem(card) {
  const digits = card.number.replace(/\D/g, '');
  if (digits.length >= 13 && !luhnValid(digits)) return 'a valid card number (this one has a typo)';
  if (!card.name.trim() || digits.length < 13 || !parseExpiry(card.expiry) || !/^\d{3,4}$/.test(card.cvc) || !card.postalCode.trim()) {
    return 'your card details (name, number, expiry MM/YY, CVC, postal code)';
  }
  return null;
}

// Card -> one-time QuickBooks Payments token (cardTokenUrl comes from /api/quickbooks/payments-config).
export async function tokenizeCard(cardTokenUrl, card, country = 'CA') {
  const { mm, yyyy } = parseExpiry(card.expiry);
  const res = await fetch(cardTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      card: {
        number: card.number.replace(/\D/g, ''),
        expMonth: mm,
        expYear: yyyy,
        cvc: card.cvc,
        name: card.name.trim(),
        address: { postalCode: card.postalCode.trim(), country: String(country || 'CA').toUpperCase() },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.value) throw new Error(data.errors?.[0]?.message || 'Your card details were not accepted. Please check them.');
  return data.value;
}
