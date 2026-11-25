'use client';
import { formatExpiry } from '@/lib/cardPayments';

// The card inputs used wherever a customer pays (booking, balance due). Values stay in the
// browser; see lib/cardPayments.js.
export default function CardFields({ card, onChange }) {
  const set = (field, clean = v => v) => (e) => onChange({ ...card, [field]: clean(e.target.value) });
  return (
    <div className="grid2">
      <div className="field"><label>Name on card *</label><input autoComplete="cc-name" value={card.name} onChange={set('name')} /></div>
      <div className="field"><label>Card number *</label><input inputMode="numeric" autoComplete="cc-number" placeholder="1234 5678 9012 3456" maxLength={23} value={card.number} onChange={set('number', v => v.replace(/[^\d ]/g, ''))} /></div>
      <div className="field"><label>Expiry (MM/YY) *</label><input inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" maxLength={7} value={card.expiry} onChange={set('expiry', formatExpiry)} /></div>
      <div className="field"><label>CVC *</label><input inputMode="numeric" autoComplete="cc-csc" maxLength={4} value={card.cvc} onChange={set('cvc', v => v.replace(/\D/g, ''))} /></div>
      <div className="field"><label>Billing postal / ZIP code *</label><input autoComplete="postal-code" value={card.postalCode} onChange={set('postalCode')} /></div>
    </div>
  );
}
