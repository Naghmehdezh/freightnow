'use client';
import { useEffect, useState } from 'react';
import { fetchAPI } from '@/lib/api';
import { FEDEX_DISCLAIMER, FEDEX_DISCLAIMER_STYLE } from '@/lib/fedexCompliance';
import { COUNTRIES } from '@/lib/countries';
import { BOOKING_CONFIRMATION } from '@/lib/disclaimers';
import { emptyCard, cardProblem, tokenizeCard } from '@/lib/cardPayments';
import CardFields from '@/components/CardFields';
import s from './BookingModal.module.css';

// Booking step: review the rate, then enter what the carrier needs to create the shipment —
// street address + contact at both ends (the quote only has city/postal code), the hold
// location for Hold at Location, and dangerous goods details. Calls onConfirm(payload) with
// the extra fields for POST /api/bookings.
export default function BookingModal({ rate, request, onCancel, onConfirm }) {
  // Options this carrier can't provide aren't part of its price, so they don't apply to this booking.
  const notIncluded = rate.notIncluded?.options || [];
  const accessorials = (request?.accessorials || []).filter(a => !notIncluded.includes(a));
  const isParcel = ['parcel', 'envelope'].includes(request?.shipmentType);
  const needsHoldLocation = accessorials.includes('hold_at_location') && rate.carrier.id === 'fedex';
  const needsDg = isParcel && accessorials.includes('hazmat') && request?.dgType !== 'BATTERY';
  const origin = request?.origin || {};
  const dest = request?.destination || {};
  // International parcels clear customs: FedEx and DHL need the contents and HS code.
  const needsCustoms = request?.shipmentType === 'parcel' && ['fedex', 'dhl'].includes(rate.carrier.id)
    && (origin.country || 'CA').toUpperCase() !== (dest.country || 'CA').toUpperCase();

  // Streets come from the addresses searched on the quote form; the unit (e.g. #1115) goes on line 2.
  const unitLine = u => (u ? `Unit ${u}` : '');
  const [shipper, setShipper] = useState({ contactName: '', companyName: '', phone: '', street1: origin.street || '', street2: unitLine(origin.unit) });
  const [recipient, setRecipient] = useState({ contactName: '', companyName: '', phone: '', email: '', street1: dest.street || '', street2: unitLine(dest.unit) });
  const [dg, setDg] = useState({ unNumber: '', properShippingName: '', hazardClass: '', packingGroup: '', quantity: '', units: 'L', emergencyPhone: '' });
  const [customs, setCustoms] = useState({ description: request?.commodity || '', hsCode: '', countryOfManufacture: (origin.country || 'CA').toUpperCase() });
  const [locations, setLocations] = useState(null); // null = loading
  const [locationError, setLocationError] = useState('');
  const [holdLocation, setHoldLocation] = useState(null);
  const [error, setError] = useState('');
  // Card customers pay at booking; monthly-terms customers are invoiced (no card).
  const [paymentTerms, setPaymentTerms] = useState(null); // 'card' | 'monthly' once the profile loads
  const [payConfig, setPayConfig] = useState(null); // { cardTokenUrl }
  const [card, setCard] = useState(emptyCard(origin.postalCode || ''));
  const [credit, setCredit] = useState(0); // store credit in this rate's currency
  const [submitting, setSubmitting] = useState(false);
  const [measurementsConfirmed, setMeasurementsConfirmed] = useState(false);
  const [account, setAccount] = useState(null); // monthly terms: available credit
  const [payWith, setPayWith] = useState('card'); // card customers: 'card' now, or 'qb_link' (QuickBooks invoice link)
  const paysByCard = paymentTerms === 'card';
  // Store credit is used first; the card pays the rest (nothing, if the credit covers it).
  const creditUsed = paysByCard ? Math.min(credit, Number(rate.displayRate)) : 0;
  const cardAmount = Math.round((Number(rate.displayRate) - creditUsed) * 100) / 100;
  // QuickBooks link: the booking is reserved and the carrier booked once the invoice is paid.
  const linkAvailable = paysByCard && cardAmount > 0 && !!payConfig?.connected;
  const payByLink = linkAvailable && payWith === 'qb_link';
  const cardNeeded = paysByCard && cardAmount > 0 && !payByLink;
  const cur = rate.currency === 'USD' ? 'US$' : 'C$';

  // Pre-fill the shipper contact from the user's profile / company. The company's street is only
  // a fallback when the quote's pickup address had no street.
  useEffect(() => {
    fetchAPI('/api/profile').then((p) => {
      setPaymentTerms(p.company?.paymentTerms || 'card');
      setCredit(Number(p.company?.credit?.[rate.currency === 'USD' ? 'USD' : 'CAD']) || 0);
      setShipper(prev => ({
        ...prev,
        contactName: prev.contactName || [p.firstName, p.lastName].filter(Boolean).join(' '),
        companyName: prev.companyName || p.company?.name || '',
        phone: prev.phone || p.phone || p.company?.phone || '',
        street1: prev.street1 || p.company?.street || '',
      }));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAPI('/api/quickbooks/payments-config').then(setPayConfig).catch(() => setPayConfig(null));
    fetchAPI('/api/billing/account').then(setAccount).catch(() => setAccount(null));
  }, []);
  // Monthly accounts book against their credit limit (CAD; USD at the account's rate).
  const priceCad = account ? Number(rate.displayRate) * (rate.currency === 'USD' ? account.fxRate : 1) : 0;
  const overLimit = paymentTerms === 'monthly' && account && priceCad > account.available;

  useEffect(() => {
    if (!needsHoldLocation) return;
    fetchAPI(`/api/fedex/locations?quoteRateId=${rate.quoteRateId}`)
      .then(d => { setLocations(d.locations || []); if (d.locations?.[0]) setHoldLocation(d.locations[0]); })
      .catch(() => { setLocations([]); setLocationError('Could not load FedEx locations. Please try again.'); });
  }, [needsHoldLocation, rate.quoteRateId]);

  const set = (setter) => (field) => (e) => setter(prev => ({ ...prev, [field]: e.target.value }));
  const setS = set(setShipper);
  const setR = set(setRecipient);
  const setD = set(setDg);
  const setC = set(setCustoms);
  async function submit() {
    if (submitting) return;
    const missing = [];
    if (!shipper.contactName || !shipper.phone || !shipper.street1) missing.push('pickup contact, phone and street');
    if (!recipient.contactName || !recipient.phone || !recipient.street1) missing.push('recipient name, phone and street');
    if (needsHoldLocation && !holdLocation) missing.push('a FedEx hold location');
    if (needsCustoms && (customs.description.trim().length < 3 || !/^\d{6,10}$/.test(customs.hsCode.replace(/[.\s]/g, '')))) {
      missing.push('what is inside and its HS code (6 to 10 digits)');
    }
    if (needsDg && (!dg.unNumber || !dg.properShippingName || !dg.hazardClass || !dg.quantity || !dg.emergencyPhone)) missing.push('dangerous goods details');
    if (cardNeeded) {
      const problem = cardProblem(card);
      if (problem) missing.push(problem);
      if (!payConfig?.cardTokenUrl) missing.push('a moment while card payments load');
    }
    if (missing.length) { setError(`Please enter ${missing.join('; ')}.`); return; }
    if (!measurementsConfirmed) { setError('Please confirm that the weights and dimensions are accurate.'); return; }
    if (overLimit) { setError('This booking is more than your available credit. Pay your statement or contact IFF to raise your limit.'); return; }

    let cardToken;
    if (cardNeeded) {
      setSubmitting(true);
      setError('');
      try {
        cardToken = await tokenizeCard(payConfig.cardTokenUrl, card, origin.country);
      } catch (err) {
        setSubmitting(false);
        setError(err.message);
        return;
      }
    }

    const trim = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => v !== ''));
    onConfirm({
      shipper: trim(shipper),
      recipient: trim(recipient),
      ...(needsHoldLocation && holdLocation && {
        holdAtLocation: { locationId: holdLocation.locationId, locationType: holdLocation.locationType, name: holdLocation.name, address: holdLocation.address },
      }),
      ...(needsCustoms && { customs: trim(customs) }),
      ...(cardToken && { cardToken }),
      ...(payByLink && { paymentMethod: 'qb_link' }),
      ...(rate.chargeCurrency && { chargeCurrency: rate.chargeCurrency }),
      measurementsConfirmed: true,
      ...(needsDg && {
        dangerousGoods: trim({ ...dg, quantity: parseFloat(dg.quantity), packingGroup: dg.packingGroup || '' }),
      }),
    });
  }

  const place = (a) => [a.city, a.province, a.postalCode, a.country].filter(Boolean).join(', ');

  return (
    <div className={s.overlay} onClick={onCancel}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-labelledby="confirm-booking-title" onClick={e => e.stopPropagation()}>
        <div id="confirm-booking-title" className={s.title}>Confirm your booking</div>
        <p className={s.text}>Enter the pickup and delivery details, then confirm. Your shipment is booked only when you confirm.</p>

        <div className={s.details}>
          <div><span>Carrier</span><b>{rate.carrier.name}, {rate.service}</b></div>
          <div><span>Transit</span><b>{rate.transitDays ? `${rate.transitDays}–${parseInt(rate.transitDays) + 1} business days` : '—'}</b></div>
          {rate.deliveryDate && <div><span>Estimated delivery</span><b>{rate.deliveryDate}</b></div>}
          <div className={s.total}>
            <span>Total</span>
            <b>{rate.currency === 'USD' ? 'US$' : 'C$'}{rate.displayRate.toFixed(2)} {rate.currency}</b>
          </div>
        </div>

        {rate.notIncluded && (
          <div className={s.notIncluded}>
            <b>Not included in this price: {rate.notIncluded.labels.join(', ')}.</b> {rate.notIncluded.message}
            {' '}You can still book; contact IFF if you need {rate.notIncluded.labels.length > 1 ? 'these services' : 'this service'}.
          </div>
        )}

        <div className={s.section}>Pickup from <span className={s.place}>{place(origin)}</span></div>
        <div className="grid2">
          <div className="field"><label>Contact name *</label><input value={shipper.contactName} onChange={setS('contactName')} /></div>
          <div className="field"><label>Company</label><input value={shipper.companyName} onChange={setS('companyName')} /></div>
          <div className="field"><label>Street address *</label><input value={shipper.street1} onChange={setS('street1')} /></div>
          <div className="field"><label>Apt / suite / unit</label><input value={shipper.street2} onChange={setS('street2')} /></div>
          <div className="field"><label>Phone *</label><input type="tel" value={shipper.phone} onChange={setS('phone')} /></div>
        </div>

        <div className={s.section}>Deliver to <span className={s.place}>{place(dest)}</span></div>
        <div className="grid2">
          <div className="field"><label>Recipient name *</label><input value={recipient.contactName} onChange={setR('contactName')} /></div>
          <div className="field"><label>Company</label><input value={recipient.companyName} onChange={setR('companyName')} /></div>
          <div className="field"><label>Street address *</label><input value={recipient.street1} onChange={setR('street1')} /></div>
          <div className="field"><label>Apt / suite / unit</label><input value={recipient.street2} onChange={setR('street2')} /></div>
          <div className="field"><label>Phone *</label><input type="tel" value={recipient.phone} onChange={setR('phone')} /></div>
          <div className="field"><label>Email</label><input type="email" value={recipient.email} onChange={setR('email')} /></div>
        </div>

        {needsHoldLocation && (
          <>
            <div className={s.section}>Hold at FedEx location *</div>
            {locations === null && <div className={s.hint}>Finding FedEx locations near the destination…</div>}
            {locationError && <div className={s.error}>{locationError}</div>}
            {locations?.length === 0 && !locationError && <div className={s.error}>No FedEx locations accept held shipments near this destination.</div>}
            <div className={s.locations}>
              {(locations || []).map(l => (
                <label key={l.locationId} className={`${s.location} ${holdLocation?.locationId === l.locationId ? s.locationActive : ''}`}>
                  <input type="radio" name="holdLocation" checked={holdLocation?.locationId === l.locationId} onChange={() => setHoldLocation(l)} />
                  <span>
                    <b>{l.name}</b> <span className={s.hint}>{l.typeLabel !== l.name ? l.typeLabel : ''}{l.distance ? `, ${l.distance}` : ''}</span><br />
                    {l.address.streetLines.join(', ')}, {l.address.city} {l.address.postalCode}
                  </span>
                </label>
              ))}
            </div>
          </>
        )}

        {needsCustoms && (
          <>
            <div className={s.section}>Customs *</div>
            <div className="grid2">
              <div className="field"><label>What is inside *</label><input placeholder="e.g. Men's cotton T-shirts" maxLength={70} value={customs.description} onChange={setC('description')} /></div>
              <div className="field"><label>HS code *</label><input placeholder="e.g. 6109.10" value={customs.hsCode} onChange={setC('hsCode')} /></div>
              <div className="field"><label>Country of manufacture *</label>
                <select value={customs.countryOfManufacture} onChange={setC('countryOfManufacture')}>
                  {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className={s.hint}>Customs needs a specific description (not just &quot;parts&quot; or &quot;gifts&quot;) and the Harmonized System (HS) code. Vague descriptions can delay clearance.</div>
          </>
        )}

        {needsDg && (
          <>
            <div className={s.section}>Dangerous goods details *</div>
            <div className="grid2">
              <div className="field"><label>UN number *</label><input placeholder="e.g. UN1263" value={dg.unNumber} onChange={setD('unNumber')} /></div>
              <div className="field"><label>Proper shipping name *</label><input placeholder="e.g. Paint" value={dg.properShippingName} onChange={setD('properShippingName')} /></div>
              <div className="field"><label>Hazard class *</label><input placeholder="e.g. 3" value={dg.hazardClass} onChange={setD('hazardClass')} /></div>
              <div className="field"><label>Packing group</label>
                <select value={dg.packingGroup} onChange={setD('packingGroup')}>
                  <option value="">None / not applicable</option><option value="I">I</option><option value="II">II</option><option value="III">III</option>
                </select>
              </div>
              <div className="field"><label>Quantity *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" min="0" step="any" value={dg.quantity} onChange={setD('quantity')} />
                  <select style={{ width: 80 }} value={dg.units} onChange={setD('units')}>
                    <option value="L">L</option><option value="ML">mL</option><option value="KG">kg</option><option value="G">g</option>
                  </select>
                </div>
              </div>
              <div className="field"><label>24-hour emergency phone *</label><input type="tel" value={dg.emergencyPhone} onChange={setD('emergencyPhone')} /></div>
            </div>
            <div className={s.hint}>IFF reviews dangerous goods shipments and completes the carrier booking; you&apos;ll receive the label once it&apos;s done.</div>
          </>
        )}

        {paysByCard && (
          <>
            <div className={s.section}>Payment{cardNeeded ? ' *' : ''}</div>
            {creditUsed > 0 && (
              <div className={`${s.hint} ${s.hintSpaced}`}>
                Store credit applied: {cur}{creditUsed.toFixed(2)}.{' '}
                {cardNeeded ? `Your card is charged the remaining ${cur}${cardAmount.toFixed(2)}.` : 'Your credit covers this booking. No card is needed.'}
              </div>
            )}
            {linkAvailable && (
              <div className={s.payChoice} role="radiogroup" aria-label="How to pay">
                <label className={payWith === 'card' ? s.payChoiceOn : ''}>
                  <input type="radio" name="payWith" checked={payWith === 'card'} onChange={() => setPayWith('card')} />
                  <span><b>Pay by card now</b><br />Your shipment is booked with the carrier straight away.</span>
                </label>
                <label className={payWith === 'qb_link' ? s.payChoiceOn : ''}>
                  <input type="radio" name="payWith" checked={payWith === 'qb_link'} onChange={() => setPayWith('qb_link')} />
                  <span><b>Pay with QuickBooks link</b><br />We reserve the booking and send you a secure QuickBooks payment link (card or bank transfer). The carrier is booked as soon as it&apos;s paid. Unpaid reservations are cancelled after 24 hours.</span>
                </label>
              </div>
            )}
            {payByLink && (
              <div className={s.hint}>You&apos;ll get the payment link for {cur}{cardAmount.toFixed(2)} right after you reserve, and by email.</div>
            )}
            {cardNeeded && (
              <>
                <CardFields card={card} onChange={setCard} />
                <div className={s.hint}>
                  Your card is charged {cur}{cardAmount.toFixed(2)}{' '}when you confirm. Card details go directly to QuickBooks Payments; IFF doesn&apos;t see or store them.
                  {payConfig?.environment === 'sandbox' && ' (Test mode: use a QuickBooks sandbox test card, e.g. 4111 1111 1111 1111.)'}
                </div>
              </>
            )}
          </>
        )}

        {paymentTerms === 'monthly' && account && (
          <>
            <div className={s.section}>Billed to your account</div>
            <div className={`${s.hint} ${overLimit ? s.hintDanger : ''}`}>
              Available credit: C${Math.max(0, account.available).toFixed(2)} of C${Number(account.creditLimit).toFixed(2)}.{' '}
              {overLimit
                ? `This booking (C$${priceCad.toFixed(2)}) is more than your available credit. Pay your statement or ask IFF to raise your limit.`
                : 'This booking is added to your monthly statement.'}
            </div>
          </>
        )}

        <label className={s.confirmBox}>
          <input type="checkbox" checked={measurementsConfirmed} onChange={e => setMeasurementsConfirmed(e.target.checked)} />
          <span>{BOOKING_CONFIRMATION}</span>
        </label>

        {error && <div className={s.error}>{error}</div>}

        <p className={s.note}>
          {paysByCard ? 'Your card is charged once, for this booking only. ' : 'The amount is added to your monthly invoice. '}
          Rates are estimates based on the weights and dimensions you entered.
        </p>
        {rate.carrier.id === 'fedex' && <p className={s.note} style={FEDEX_DISCLAIMER_STYLE}>{FEDEX_DISCLAIMER}</p>}
        <div className={s.actions}>
          <span className={s.actionsTotal}>{rate.currency === 'USD' ? 'US$' : 'C$'}{rate.displayRate.toFixed(2)} {rate.currency}</span>
          <button type="button" className={s.btnCancel} onClick={onCancel}>Cancel</button>
          <button type="button" className={s.btnConfirm} onClick={submit} disabled={submitting}>{submitting ? 'Checking card…' : payByLink ? 'Reserve and get payment link' : paysByCard ? 'Pay and book' : 'Confirm booking'}</button>
        </div>
      </div>
    </div>
  );
}
