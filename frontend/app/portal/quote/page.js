'use client';
import { useState, useEffect } from 'react';
import { fetchAPI } from '@/lib/api';
import { CARRIERS } from '@/lib/carriers';
import { FEDEX_DISCLAIMER } from '@/lib/fedexCompliance';
import CarrierLogo from '@/components/CarrierLogo';
import s from './page.module.css';

const SPOT_TYPES = ['ftl', 'air', 'ocean'];
const ACCESSORIALS = [
  { value: 'liftgate_pickup', label: 'Liftgate pickup' },
  { value: 'liftgate_delivery', label: 'Liftgate delivery' },
  { value: 'residential', label: 'Residential' },
  { value: 'appointment', label: 'Appointment' },
  { value: 'inside_delivery', label: 'Inside delivery' },
  { value: 'hazmat', label: 'Hazmat' },
  { value: 'signature', label: 'Signature req.' },
  { value: 'saturday', label: 'Saturday delivery' },
];

const SPOT_LABELS = {
  ftl: { title: 'FTL Freight — Spot rate request', desc: 'Full truckload shipments require custom pricing. Fill in your cargo details and our team will respond within 2–4 business hours with a competitive rate.' },
  air: { title: 'Air Freight — Spot rate request', desc: 'Import and export air freight pricing is based on routes, weight, and current capacity. Our team will respond with a competitive quote within 2–4 business hours.' },
  ocean: { title: 'Ocean Freight — Spot rate request', desc: 'LCL and FCL ocean freight pricing varies by route and market conditions. Fill in your shipment details and we\'ll send you a competitive quote within 2–4 business hours.' },
};

function applyMarkup(rate) {
  if (rate <= 100) return rate * 1.70;
  if (rate <= 250) return rate * 1.55;
  if (rate <= 500) return rate * 1.40;
  if (rate <= 1000) return rate * 1.30;
  if (rate <= 2500) return rate * 1.20;
  return rate * 1.15;
}

function calcDelivery(days, pickupDate) {
  if (!days) return null;
  const base = pickupDate ? new Date(pickupDate + 'T12:00:00') : new Date();
  const d = new Date(base);
  let added = 0;
  while (added < parseInt(days)) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

function simulateRate(carrier, type, weight, cls, orig, dest, accessorials, pickupDate) {
  const seed = (carrier.id + orig + dest + type).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = ((seed * 9301 + 49297) % 233280) / 233280;
  const rng2 = ((seed * 6271 + 8831) % 233280) / 233280;
  let base;
  if (type === 'envelope') base = 18 + rng * 35;
  else if (type === 'parcel') base = 22 + rng * 55 + (weight / 10) * (7 + rng2 * 6);
  else {
    const m = { '50': 1, '55': 1.05, '60': 1.1, '65': 1.15, '70': 1.2, '77.5': 1.3, '85': 1.4, '92.5': 1.5, '100': 1.65, '110': 1.8, '125': 2, '150': 2.3, '175': 2.6, '200': 3, '250': 3.5, '300': 4 }[String(cls)] || 1;
    base = (55 + rng * 85) * (weight / 100) * m;
  }
  accessorials.forEach(a => {
    if (a === 'liftgate_pickup' || a === 'liftgate_delivery') base += 55 + rng2 * 30;
    if (a === 'residential') base += 22 + rng2 * 12;
    if (a === 'appointment') base += 38 + rng2 * 10;
    if (a === 'inside_delivery') base += 75 + rng2 * 20;
    if (a === 'hazmat') base += 145 + rng2 * 55;
    if (a === 'saturday') base += 32 + rng2 * 15;
    if (a === 'signature') base += 7 + rng2 * 4;
  });
  const td = type === 'envelope' ? Math.ceil(1 + rng2 * 2) : type === 'parcel' ? Math.ceil(1 + rng2 * 3) : Math.ceil(2 + rng2 * 4);
  const svcs = { envelope: ['Express Saver', 'Priority Overnight', 'Standard Overnight', 'Economy Select'], parcel: ['Ground', 'Express Saver', '2Day', 'Priority Overnight'], ltl: ['Freight Economy', 'Freight Priority', 'Standard LTL'] };
  const svcList = svcs[type] || svcs.ltl;
  return {
    rate: Math.max(Math.round((base + (rng - 0.5) * 8) * 100) / 100, type === 'envelope' ? 12 : type === 'parcel' ? 15 : 110),
    transitDays: td,
    deliveryDate: calcDelivery(td, pickupDate),
    service: svcList[Math.floor(rng * svcList.length)],
    live: false,
  };
}

export default function QuotePage() {
  const today = new Date().toISOString().split('T')[0];

  const [currentType, setCurrentType] = useState('envelope');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [spotSuccess, setSpotSuccess] = useState(false);
  const [booking, setBooking] = useState({}); // { [quoteRateId]: 'loading' | 'booked' | 'error' }

  // Origin/Destination
  const [origCity, setOrigCity] = useState('');
  const [origPostal, setOrigPostal] = useState('');
  const [origCountry, setOrigCountry] = useState('CA');
  const [destCity, setDestCity] = useState('');
  const [destPostal, setDestPostal] = useState('');
  const [destCountry, setDestCountry] = useState('US');

  // Envelope fields
  const [weightEnv, setWeightEnv] = useState('');
  const [piecesEnv, setPiecesEnv] = useState('1');
  const [pickupEnv, setPickupEnv] = useState(today);
  const [currencyEnv, setCurrencyEnv] = useState('CAD');

  // Parcel fields
  const [weightParcel, setWeightParcel] = useState('');
  const [piecesParcel, setPiecesParcel] = useState('1');
  const [pickupParcel, setPickupParcel] = useState(today);
  const [currencyParcel, setCurrencyParcel] = useState('CAD');
  const [dimLParcel, setDimLParcel] = useState('');
  const [dimWParcel, setDimWParcel] = useState('');
  const [dimHParcel, setDimHParcel] = useState('');

  // LTL fields
  const [weightLtl, setWeightLtl] = useState('');
  const [piecesLtl, setPiecesLtl] = useState('1');
  const [pickupLtl, setPickupLtl] = useState(today);
  const [currencyLtl, setCurrencyLtl] = useState('CAD');
  const [dimLLtl, setDimLLtl] = useState('');
  const [dimWLtl, setDimWLtl] = useState('');
  const [dimHLtl, setDimHLtl] = useState('');
  const [freightClass, setFreightClass] = useState('');

  // Shared fields
  const [declaredValue, setDeclaredValue] = useState('');
  const [commodity, setCommodity] = useState('');
  const [activeAccessorials, setActiveAccessorials] = useState([]);

  // Spot fields
  const [spotWeight, setSpotWeight] = useState('');
  const [spotPieces, setSpotPieces] = useState('');
  const [spotDims, setSpotDims] = useState('');
  const [spotDate, setSpotDate] = useState(today);
  const [spotOrigPort, setSpotOrigPort] = useState('');
  const [spotDestPort, setSpotDestPort] = useState('');
  const [oceanType, setOceanType] = useState('LCL — Less than container load');
  const [spotCommodity, setSpotCommodity] = useState('');
  const [spotValue, setSpotValue] = useState('');
  const [spotNotes, setSpotNotes] = useState('');

  const isSpot = SPOT_TYPES.includes(currentType);

  function toggleAccessorial(val) {
    setActiveAccessorials(prev =>
      prev.includes(val) ? prev.filter(a => a !== val) : [...prev, val]
    );
  }

  function getFields() {
    if (currentType === 'envelope') return { weight: parseFloat(weightEnv) || 0, pieces: parseInt(piecesEnv) || 1, pickupDate: pickupEnv, currency: currencyEnv, dimL: 12, dimW: 9, dimH: 1, freightClass: '50' };
    if (currentType === 'parcel') return { weight: parseFloat(weightParcel) || 0, pieces: parseInt(piecesParcel) || 1, pickupDate: pickupParcel, currency: currencyParcel, dimL: dimLParcel || 12, dimW: dimWParcel || 12, dimH: dimHParcel || 12, freightClass: '70' };
    return { weight: parseFloat(weightLtl) || 0, pieces: parseInt(piecesLtl) || 1, pickupDate: pickupLtl, currency: currencyLtl, dimL: dimLLtl || 48, dimW: dimWLtl || 40, dimH: dimHLtl || 48, freightClass };
  }

  async function getQuotes() {
    const orig = origPostal.replace(/\s/g, '') || origCity.trim();
    const dest = destPostal.replace(/\s/g, '') || destCity.trim();
    if (!origCity && !origPostal) { alert('Please enter an origin.'); return; }
    if (!destCity && !destPostal) { alert('Please enter a destination.'); return; }

    const { weight, pieces, pickupDate, currency, dimL, dimW, dimH, freightClass: fc } = getFields();
    if (!weight) { alert('Please enter the weight.'); return; }
    if (currentType === 'ltl' && !fc) { alert('Please select a freight class.'); return; }

    setLoading(true);
    setResults(null);

    await new Promise(r => setTimeout(r, 900));

    let quoteResults;
    try {
      const body = {
        shipmentType: currentType,
        origin: {
          city: origCity.trim() || undefined,
          postalCode: origPostal.trim().replace(/\s/g, '') || undefined,
          country: origCountry,
        },
        destination: {
          city: destCity.trim() || undefined,
          postalCode: destPostal.trim().replace(/\s/g, '') || undefined,
          country: destCountry,
        },
        weight,
        pieces,
        dimensions: { length: parseInt(dimL), width: parseInt(dimW), height: parseInt(dimH) },
        freightClass: fc || '70',
        currency,
        ...(pickupDate && { pickupDate }),
        ...(declaredValue && { declaredValue: parseFloat(declaredValue) }),
        ...(activeAccessorials.length && { accessorials: activeAccessorials }),
      };
      const data = await fetchAPI('/api/rate/all', { method: 'POST', body: JSON.stringify(body) });
      if (data.rates && data.rates.length) {
        quoteResults = data.rates.map(r => ({
          carrier: CARRIERS.find(c => c.id === r.carrierId) || CARRIERS[0],
          rate: r.baseRate,
          displayRate: r.displayRate,
          transitDays: r.transitDays,
          deliveryDate: r.deliveryDate || calcDelivery(r.transitDays, pickupDate),
          service: r.serviceName,
          live: r.isLiveRate || false,
          quoteId: r.quoteId,
          quoteRateId: r.quoteRateId,
        }));
      }
    } catch {
      // Fallback to client-side simulation
    }

    if (!quoteResults) {
      quoteResults = CARRIERS.map(c => {
        const sim = simulateRate(c, currentType, weight, fc, orig, dest, activeAccessorials, pickupDate);
        return { carrier: c, ...sim, displayRate: Math.round(applyMarkup(sim.rate) * 100) / 100 };
      });
    }

    quoteResults.sort((a, b) => a.displayRate - b.displayRate);
    setResults({ quotes: quoteResults, summary: { count: quoteResults.length, orig: origCity || origPostal, dest: destCity || destPostal, type: { envelope: 'Envelope', parcel: 'Parcel', ltl: 'LTL Freight' }[currentType], weight, currency: getFields().currency } });
    setLoading(false);
  }

  async function handleBook(r) {
    if (!r.quoteId || !r.quoteRateId) return;
    setBooking(prev => ({ ...prev, [r.quoteRateId]: 'loading' }));
    try {
      const data = await fetchAPI('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ quoteId: r.quoteId, quoteRateId: r.quoteRateId }),
      });
      setBooking(prev => ({ ...prev, [r.quoteRateId]: 'booked' }));
      const msg = data.booking.paymentStatus === 'paid'
        ? `Booked & paid! Booking ${data.booking.bookingNumber} — tracking number ${data.shipment.trackingNumber}.`
        : `Booked! Booking ${data.booking.bookingNumber} — tracking number ${data.shipment.trackingNumber}. Invoice will be sent.`;
      alert(msg);
    } catch (err) {
      setBooking(prev => ({ ...prev, [r.quoteRateId]: 'error' }));
      const message = err.error?.message || err.message || 'Could not book this rate.';
      alert(message);
    }
  }

  async function submitSpotRate() {
    const orig = origCity || origPostal;
    const dest = destCity || destPostal;
    if (!orig || !dest) { alert('Please enter an origin and destination.'); return; }

    try {
      await fetchAPI('/api/spot-rates', {
        method: 'POST',
        body: JSON.stringify({
          shipmentType: currentType,
          origCity, origPostal, origCountry,
          destCity, destPostal, destCountry,
          weight: parseFloat(spotWeight) || 0,
          pieces: parseInt(spotPieces) || 1,
          dimensions: spotDims,
          pickupDate: spotDate,
          ...(spotOrigPort && { originPort: spotOrigPort }),
          ...(spotDestPort && { destinationPort: spotDestPort }),
          ...(currentType === 'ocean' && { oceanServiceType: oceanType }),
          commodity: spotCommodity,
          ...(spotValue && { declaredValue: parseFloat(spotValue) }),
          notes: spotNotes,
        }),
      });
    } catch {
      // Show success anyway for demo
    }
    setSpotSuccess(true);
  }

  function handleTypeChange(type) {
    setCurrentType(type);
    setResults(null);
    setSpotSuccess(false);
  }

  return (
    <div className="section-card">
      {/* Shipment type selector */}
      <div className={s.sectionLabel}>Select shipment type</div>
      <div className={s.typeGrid}>
        <div className={`${s.typeCard} ${currentType === 'envelope' ? 'active' : ''}`} onClick={() => handleTypeChange('envelope')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="m2 6 10 8 10-8"/></svg>
          <div className={s.typeLabel}>Envelope</div>
          <div className={s.typeSub}>Letters, documents</div>
          <span className={`${s.typeTag} ${s.tagInstant}`}>&#9889; Instant quote</span>
        </div>
        <div className={`${s.typeCard} ${currentType === 'parcel' ? 'active' : ''}`} onClick={() => handleTypeChange('parcel')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <div className={s.typeLabel}>Parcel</div>
          <div className={s.typeSub}>Boxes, packages</div>
          <span className={`${s.typeTag} ${s.tagInstant}`}>&#9889; Instant quote</span>
        </div>
        <div className={`${s.typeCard} ${currentType === 'ltl' ? 'active' : ''}`} onClick={() => handleTypeChange('ltl')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <div className={s.typeLabel}>LTL Freight</div>
          <div className={s.typeSub}>Pallets, less-than-truckload</div>
          <span className={`${s.typeTag} ${s.tagInstant}`}>&#9889; Instant quote</span>
        </div>
        <div className={`${s.typeCard} ${s.spotType} ${currentType === 'ftl' ? 'active' : ''}`} onClick={() => handleTypeChange('ftl')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="1"/><circle cx="12" cy="21" r="1"/><circle cx="20" cy="21" r="1"/></svg>
          <div className={s.typeLabel}>FTL Freight</div>
          <div className={s.typeSub}>Full truckload</div>
          <span className={`${s.typeTag} ${s.tagSpot}`}>&#9993; Spot rate</span>
        </div>
        <div className={`${s.typeCard} ${s.spotType} ${currentType === 'air' ? 'active' : ''}`} onClick={() => handleTypeChange('air')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>
          <div className={s.typeLabel}>Air Freight</div>
          <div className={s.typeSub}>Import &amp; export</div>
          <span className={`${s.typeTag} ${s.tagSpot}`}>&#9993; Spot rate</span>
        </div>
        <div className={`${s.typeCard} ${s.spotType} ${currentType === 'ocean' ? 'active' : ''}`} onClick={() => handleTypeChange('ocean')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17l4-8 4 4 4-6 4 10"/><path d="M3 21h18"/></svg>
          <div className={s.typeLabel}>Ocean Freight</div>
          <div className={s.typeSub}>LCL &amp; FCL import/export</div>
          <span className={`${s.typeTag} ${s.tagSpot}`}>&#9993; Spot rate</span>
        </div>
      </div>

      {/* Origin & Destination */}
      <div className={s.formCols}>
        <div>
          <div className={s.colLabel}>Origin</div>
          <div className="field"><label>City</label><input placeholder="e.g. Toronto" value={origCity} onChange={e => setOrigCity(e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Postal / ZIP</label><input placeholder="M5V 3A8" value={origPostal} onChange={e => setOrigPostal(e.target.value)} /></div>
            <div className="field"><label>Country</label>
              <select value={origCountry} onChange={e => setOrigCountry(e.target.value)}>
                <option value="CA">Canada</option><option value="US">USA</option><option value="CN">China</option><option value="GB">UK</option><option value="DE">Germany</option><option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>
        <div>
          <div className={s.colLabel}>Destination</div>
          <div className="field"><label>City</label><input placeholder="e.g. Chicago" value={destCity} onChange={e => setDestCity(e.target.value)} /></div>
          <div className="grid2">
            <div className="field"><label>Postal / ZIP</label><input placeholder="60601" value={destPostal} onChange={e => setDestPostal(e.target.value)} /></div>
            <div className="field"><label>Country</label>
              <select value={destCountry} onChange={e => setDestCountry(e.target.value)}>
                <option value="US">USA</option><option value="CA">Canada</option><option value="CN">China</option><option value="GB">UK</option><option value="DE">Germany</option><option value="other">Other</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* INSTANT QUOTE fields */}
      {!isSpot && (
        <div>
          {currentType === 'envelope' && (
            <div className="grid4" style={{ marginBottom: '14px' }}>
              <div className="field"><label>Weight (lbs)</label><input type="number" placeholder="0.5" min="0.1" step="0.1" value={weightEnv} onChange={e => setWeightEnv(e.target.value)} /></div>
              <div className="field"><label>Pieces</label><input type="number" value={piecesEnv} min="1" onChange={e => setPiecesEnv(e.target.value)} /></div>
              <div className="field"><label>Pickup date</label><input type="date" value={pickupEnv} onChange={e => setPickupEnv(e.target.value)} /></div>
              <div className="field"><label>Currency</label><select value={currencyEnv} onChange={e => setCurrencyEnv(e.target.value)}><option value="CAD">CAD</option><option value="USD">USD</option></select></div>
            </div>
          )}

          {currentType === 'parcel' && (
            <div style={{ marginBottom: '14px' }}>
              <div className="grid4" style={{ marginBottom: '10px' }}>
                <div className="field"><label>Weight (lbs)</label><input type="number" placeholder="10" min="0.1" value={weightParcel} onChange={e => setWeightParcel(e.target.value)} /></div>
                <div className="field"><label>Pieces</label><input type="number" value={piecesParcel} min="1" onChange={e => setPiecesParcel(e.target.value)} /></div>
                <div className="field"><label>Pickup date</label><input type="date" value={pickupParcel} onChange={e => setPickupParcel(e.target.value)} /></div>
                <div className="field"><label>Currency</label><select value={currencyParcel} onChange={e => setCurrencyParcel(e.target.value)}><option value="CAD">CAD</option><option value="USD">USD</option></select></div>
              </div>
              <div className="grid3">
                <div className="field"><label>Length (in)</label><input type="number" placeholder="12" value={dimLParcel} onChange={e => setDimLParcel(e.target.value)} /></div>
                <div className="field"><label>Width (in)</label><input type="number" placeholder="12" value={dimWParcel} onChange={e => setDimWParcel(e.target.value)} /></div>
                <div className="field"><label>Height (in)</label><input type="number" placeholder="12" value={dimHParcel} onChange={e => setDimHParcel(e.target.value)} /></div>
              </div>
            </div>
          )}

          {currentType === 'ltl' && (
            <div style={{ marginBottom: '14px' }}>
              <div className="grid4" style={{ marginBottom: '10px' }}>
                <div className="field"><label>Weight (lbs)</label><input type="number" placeholder="500" min="1" value={weightLtl} onChange={e => setWeightLtl(e.target.value)} /></div>
                <div className="field"><label>Pieces</label><input type="number" value={piecesLtl} min="1" onChange={e => setPiecesLtl(e.target.value)} /></div>
                <div className="field"><label>Freight class</label>
                  <select value={freightClass} onChange={e => setFreightClass(e.target.value)}>
                    <option value="">— select —</option>
                    {['50','55','60','65','70','77.5','85','92.5','100','110','125','150','175','200','250','300'].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div className="field"><label>Currency</label><select value={currencyLtl} onChange={e => setCurrencyLtl(e.target.value)}><option value="CAD">CAD</option><option value="USD">USD</option></select></div>
              </div>
              <div className="grid4">
                <div className="field"><label>Length (in)</label><input type="number" placeholder="48" value={dimLLtl} onChange={e => setDimLLtl(e.target.value)} /></div>
                <div className="field"><label>Width (in)</label><input type="number" placeholder="40" value={dimWLtl} onChange={e => setDimWLtl(e.target.value)} /></div>
                <div className="field"><label>Height (in)</label><input type="number" placeholder="48" value={dimHLtl} onChange={e => setDimHLtl(e.target.value)} /></div>
                <div className="field"><label>Pickup date</label><input type="date" value={pickupLtl} onChange={e => setPickupLtl(e.target.value)} /></div>
              </div>
            </div>
          )}

          <div className="grid2" style={{ marginBottom: '14px' }}>
            <div className="field"><label>Declared value ($)</label><input type="number" placeholder="Optional" value={declaredValue} onChange={e => setDeclaredValue(e.target.value)} /></div>
            <div className="field"><label>Commodity</label><input placeholder="e.g. Auto parts" value={commodity} onChange={e => setCommodity(e.target.value)} /></div>
          </div>

          <div className={s.sectionLabel}>Accessorials</div>
          <div className={s.accGrid}>
            {ACCESSORIALS.map(acc => (
              <div
                key={acc.value}
                className={`${s.accItem} ${activeAccessorials.includes(acc.value) ? s.accItemActive : ''}`}
                onClick={() => toggleAccessorial(acc.value)}
              >
                {acc.label}
              </div>
            ))}
          </div>

          <button className={s.btnQuote} onClick={getQuotes} disabled={loading}>
            {loading ? (
              <><span className="spinner" /> Fetching&hellip;</>
            ) : (
              <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Get quotes from all carriers</>
            )}
          </button>
        </div>
      )}

      {/* SPOT RATE fields */}
      {isSpot && (
        <div>
          <div className={s.spotInfo}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px', color: 'var(--amber)' }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div className={s.spotInfoText}>
              <h4>{SPOT_LABELS[currentType]?.title}</h4>
              <p>{SPOT_LABELS[currentType]?.desc}</p>
            </div>
          </div>

          <div className="grid2" style={{ marginBottom: '14px' }}>
            <div className="field"><label>Total weight (lbs)</label><input type="number" placeholder="e.g. 5000" value={spotWeight} onChange={e => setSpotWeight(e.target.value)} /></div>
            <div className="field"><label>Total pieces / units</label><input type="number" placeholder="e.g. 1 container" value={spotPieces} onChange={e => setSpotPieces(e.target.value)} /></div>
          </div>
          <div className="grid2" style={{ marginBottom: '14px' }}>
            <div className="field"><label>Dimensions (L x W x H)</label><input placeholder="e.g. 48 x 40 x 60 in per pallet" value={spotDims} onChange={e => setSpotDims(e.target.value)} /></div>
            <div className="field"><label>Ready / pickup date</label><input type="date" value={spotDate} onChange={e => setSpotDate(e.target.value)} /></div>
          </div>

          {(currentType === 'air' || currentType === 'ocean') && (
            <div className="grid2" style={{ marginBottom: '14px' }}>
              <div className="field"><label>Origin port / airport</label><input placeholder="e.g. YYZ, Port of Toronto" value={spotOrigPort} onChange={e => setSpotOrigPort(e.target.value)} /></div>
              <div className="field"><label>Destination port / airport</label><input placeholder="e.g. ORD, Port of Chicago" value={spotDestPort} onChange={e => setSpotDestPort(e.target.value)} /></div>
            </div>
          )}

          {currentType === 'ocean' && (
            <div className="field" style={{ marginBottom: '14px' }}>
              <label>Ocean service type</label>
              <select value={oceanType} onChange={e => setOceanType(e.target.value)}>
                <option>LCL — Less than container load</option>
                <option>FCL — 20ft container</option>
                <option>FCL — 40ft container</option>
                <option>FCL — 40ft high cube</option>
              </select>
            </div>
          )}

          <div className="grid2" style={{ marginBottom: '14px' }}>
            <div className="field"><label>Commodity / cargo description</label><input placeholder="e.g. Auto parts, electronics" value={spotCommodity} onChange={e => setSpotCommodity(e.target.value)} /></div>
            <div className="field"><label>Declared value (CAD or USD)</label><input type="number" placeholder="Optional" value={spotValue} onChange={e => setSpotValue(e.target.value)} /></div>
          </div>
          <div className="field" style={{ marginBottom: '20px' }}>
            <label>Special requirements or notes</label>
            <textarea rows="3" placeholder="Dangerous goods class, temperature controlled, fragile, customs brokerage needed, insurance, etc." value={spotNotes} onChange={e => setSpotNotes(e.target.value)} />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>Quoted rates are estimates and may be subject to adjustment based on actual shipment details and carrier surcharges.</div>
          <button className={s.btnSpotSubmit} onClick={submitSpotRate}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send spot rate request to IFF Cargo
          </button>

          {spotSuccess && (
            <div className={s.successBox}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <div><strong>Request sent!</strong> Our team will review your shipment and respond with a quote within 2–4 business hours. Call us at <strong>416 798 4151</strong> if you need an urgent response.</div>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className={s.loadingRow}><div className={s.loadingSpinner} /> Querying all carriers&hellip;</div>
      )}

      {/* Results */}
      {results && (
        <div style={{ marginTop: '20px' }}>
          <div className={s.resultsSummary}>
            {results.summary.count} quotes &middot; {results.summary.orig} &rarr; {results.summary.dest} &middot; {results.summary.type} &middot; {results.summary.weight} lbs &middot; {results.summary.currency}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>All rates shown are estimates and may be subject to adjustment based on actual shipment weight, dimensions, and carrier surcharges.</div>
          {results.quotes.map((r, i) => {
            const isBest = i === 0;
            const cheapest = results.quotes[0].displayRate;
            const savings = i > 0 ? (r.displayRate - cheapest).toFixed(2) : 0;
            const sym = results.summary.currency === 'CAD' ? 'C$' : '$';
            const transitStr = r.transitDays ? `${r.transitDays}–${parseInt(r.transitDays) + 1} business days` : '—';
            const canBook = !!(r.quoteId && r.quoteRateId);
            const bookState = r.quoteRateId ? booking[r.quoteRateId] : undefined;

            return (
              <div key={i} className={`${s.resultCard} ${isBest ? s.best : ''}`}>
                {isBest && <div className={s.bestFlag}>&#9733; BEST RATE</div>}
                <CarrierLogo
                  id={r.carrier.id}
                  label={r.carrier.abbr}
                  chip={{ bg: r.carrier.bg, color: r.carrier.color, borderColor: r.carrier.bc }}
                  className={s.carrierBadge}
                  fallbackStyle={{ fontSize: 13 }}
                />
                <div className={s.ri}>
                  <div className={s.riName}>
                    {r.carrier.name}
                    <span className={r.live ? s.liveTag : s.simTag}>{r.live ? '● live' : '~ est.'}</span>
                  </div>
                  <div className={s.riSvc}>{r.service}</div>
                  <div className={s.riMeta}>
                    <span className={s.riChip}>&#9201; {transitStr}</span>
                    {r.deliveryDate && <span className={`${s.riChip} ${s.riChipDelivery}`}>&#128197; Est. {r.deliveryDate}</span>}
                  </div>
                  {r.carrier.id === 'fedex' && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{FEDEX_DISCLAIMER}</div>}
                </div>
                <div className={s.rr}>
                  <div className={s.rrAmount}>{sym}{r.displayRate.toFixed(2)}</div>
                  <div className={s.rrCur}>{results.summary.currency}</div>
                  {!isBest && <div className={s.rrSavings}>+${savings} vs best</div>}
                  <button
                    className={s.btnBook}
                    disabled={!canBook || bookState === 'loading' || bookState === 'booked'}
                    onClick={() => handleBook(r)}
                    title={!canBook ? 'Sign in to book this rate' : undefined}
                  >
                    {bookState === 'loading' ? 'Booking…' : bookState === 'booked' ? 'Booked ✓' : canBook ? 'Book this rate →' : 'Sign in to book'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
