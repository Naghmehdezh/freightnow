'use client';
import { useEffect, useState } from 'react';
import { fetchAPI } from '@/lib/api';
import { FEDEX_DISCLAIMER, FEDEX_DISCLAIMER_STYLE } from '@/lib/fedexCompliance';
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

  // Streets come from the addresses searched on the quote form; the unit (e.g. #1115) goes on line 2.
  const unitLine = u => (u ? `Unit ${u}` : '');
  const [shipper, setShipper] = useState({ contactName: '', companyName: '', phone: '', street1: origin.street || '', street2: unitLine(origin.unit) });
  const [recipient, setRecipient] = useState({ contactName: '', companyName: '', phone: '', email: '', street1: dest.street || '', street2: unitLine(dest.unit) });
  const [dg, setDg] = useState({ unNumber: '', properShippingName: '', hazardClass: '', packingGroup: '', quantity: '', units: 'L', emergencyPhone: '' });
  const [locations, setLocations] = useState(null); // null = loading
  const [locationError, setLocationError] = useState('');
  const [holdLocation, setHoldLocation] = useState(null);
  const [error, setError] = useState('');

  // Pre-fill the shipper contact from the user's profile / company. The company's street is only
  // a fallback when the quote's pickup address had no street.
  useEffect(() => {
    fetchAPI('/api/profile').then((p) => {
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
    if (!needsHoldLocation) return;
    fetchAPI(`/api/fedex/locations?quoteRateId=${rate.quoteRateId}`)
      .then(d => { setLocations(d.locations || []); if (d.locations?.[0]) setHoldLocation(d.locations[0]); })
      .catch(() => { setLocations([]); setLocationError('Could not load FedEx locations. Please try again.'); });
  }, [needsHoldLocation, rate.quoteRateId]);

  const set = (setter) => (field) => (e) => setter(prev => ({ ...prev, [field]: e.target.value }));
  const setS = set(setShipper);
  const setR = set(setRecipient);
  const setD = set(setDg);

  function submit() {
    const missing = [];
    if (!shipper.contactName || !shipper.phone || !shipper.street1) missing.push('pickup contact, phone and street');
    if (!recipient.contactName || !recipient.phone || !recipient.street1) missing.push('recipient name, phone and street');
    if (needsHoldLocation && !holdLocation) missing.push('a FedEx hold location');
    if (needsDg && (!dg.unNumber || !dg.properShippingName || !dg.hazardClass || !dg.quantity || !dg.emergencyPhone)) missing.push('dangerous goods details');
    if (missing.length) { setError(`Please enter ${missing.join('; ')}.`); return; }

    const trim = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => v !== ''));
    onConfirm({
      shipper: trim(shipper),
      recipient: trim(recipient),
      ...(needsHoldLocation && holdLocation && {
        holdAtLocation: { locationId: holdLocation.locationId, locationType: holdLocation.locationType, name: holdLocation.name, address: holdLocation.address },
      }),
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
          <div><span>Carrier</span><b>{rate.carrier.name} — {rate.service}</b></div>
          <div><span>Transit</span><b>{rate.transitDays ? `${rate.transitDays}–${parseInt(rate.transitDays) + 1} business days` : '—'}</b></div>
          {rate.deliveryDate && <div><span>Est. delivery</span><b>{rate.deliveryDate}</b></div>}
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
                    <b>{l.name}</b> <span className={s.hint}>{l.typeLabel !== l.name ? l.typeLabel : ''}{l.distance ? ` · ${l.distance}` : ''}</span><br />
                    {l.address.streetLines.join(', ')}, {l.address.city} {l.address.postalCode}
                  </span>
                </label>
              ))}
            </div>
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

        {error && <div className={s.error}>{error}</div>}

        <p className={s.note}>
          Your default payment method will be charged, or the amount added to your monthly invoice if your account has payment terms.
          Rates are estimates and may be adjusted for actual weight, dimensions and carrier surcharges.
        </p>
        {rate.carrier.id === 'fedex' && <p className={s.note} style={FEDEX_DISCLAIMER_STYLE}>{FEDEX_DISCLAIMER}</p>}
        <div className={s.actions}>
          <button type="button" className={s.btnCancel} onClick={onCancel}>Cancel</button>
          <button type="button" className={s.btnConfirm} onClick={submit}>Confirm booking</button>
        </div>
      </div>
    </div>
  );
}
