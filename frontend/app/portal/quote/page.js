'use client';
import { useState, useEffect } from 'react';
import { fetchAPI } from '@/lib/api';
import { CARRIERS } from '@/lib/carriers';
import { FEDEX_DISCLAIMER, FEDEX_DISCLAIMER_STYLE } from '@/lib/fedexCompliance';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { estimateFreightClass, FREIGHT_CLASSES } from '@/lib/freightClass';

const DHL_DISCLAIMER = 'DHL and the DHL logo are trademarks of Deutsche Post AG and are used by permission.';
import CarrierLogo from '@/components/CarrierLogo';
import BookingModal from '@/components/BookingModal';
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
// Envelopes and parcels: no liftgate/inside delivery (freight-only services); signature and
// dangerous goods need a type, chosen below the options.
const PARCEL_ACCESSORIALS = [
  { value: 'residential', label: 'Residential' },
  { value: 'saturday', label: 'Saturday delivery' },
  { value: 'saturday_pickup', label: 'Saturday pickup', hint: 'Pickup date must be a Saturday' },
  { value: 'signature', label: 'Signature' },
  { value: 'hold_at_location', label: 'Hold at location', hint: 'Recipient collects at a carrier location' },
  { value: 'home_delivery', label: 'Home delivery option', hint: 'US residential only' },
  { value: 'hazmat', label: 'Dangerous goods' },
];
const HOME_DELIVERY_TYPES = [
  { value: 'appointment', label: 'Appointment' },
  { value: 'evening_delivery', label: 'Evening delivery' },
  { value: 'date_certain', label: 'On a chosen date' },
];
const DG_TYPES = [
  { value: 'ACCESSIBLE', label: 'Fully regulated, accessible (most DG classes)' },
  { value: 'INACCESSIBLE', label: 'Fully regulated, inaccessible (e.g. class 9, some class 3/6.1)' },
  { value: 'SMALL_QUANTITY_EXCEPTION', label: 'Small quantity exception' },
  { value: 'BATTERY', label: 'Lithium batteries (Section II)' },
];

// Next Saturday on or after a YYYY-MM-DD date.
function nextSaturday(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d.toISOString().split('T')[0];
}
const SIGNATURE_TYPES = [
  { value: 'signature_indirect', label: 'Indirect: anyone at the address, or a neighbour' },
  { value: 'signature_direct', label: 'Direct: someone at the delivery address' },
  { value: 'signature_adult', label: 'Adult: recipient of legal age, with ID' },
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
  const [confirmRate, setConfirmRate] = useState(null); // rate awaiting the user's booking confirmation
  const [labels, setLabels] = useState({}); // { [quoteRateId]: { encodedLabel, docType, trackingNumber } }
  const [originValidation, setOriginValidation] = useState(null);
  const [destValidation, setDestValidation] = useState(null);
  const [validating, setValidating] = useState(false);

  // Origin/Destination
  const [origCity, setOrigCity] = useState('');
  const [origProvince, setOrigProvince] = useState('');
  const [origPostal, setOrigPostal] = useState('');
  const [origCountry, setOrigCountry] = useState('CA');
  const [destCity, setDestCity] = useState('');
  const [destProvince, setDestProvince] = useState('');
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
  const [freightClassAuto, setFreightClassAuto] = useState(true);
  const [fedexPackaging, setFedexPackaging] = useState('YOUR_PACKAGING'); // FedEx-only: branded packaging
  const [fedexOneRate, setFedexOneRate] = useState(false); // calculate from weight + dimensions unless the user picks one

  // Shared fields
  const [declaredValue, setDeclaredValue] = useState('');
  const [commodity, setCommodity] = useState('');
  const [activeAccessorials, setActiveAccessorials] = useState([]);
  const [signatureType, setSignatureType] = useState('signature_direct');
  const [dgType, setDgType] = useState('ACCESSIBLE');
  const [batteryMaterial, setBatteryMaterial] = useState('LITHIUM_ION');
  const [batteryPacking, setBatteryPacking] = useState('CONTAINED_IN_EQUIPMENT');
  const [homeDeliveryType, setHomeDeliveryType] = useState('appointment');
  const [homeDeliveryDate, setHomeDeliveryDate] = useState('');

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
  const isParcelType = currentType === 'parcel' || currentType === 'envelope';
  const accessorialOptions = isParcelType ? PARCEL_ACCESSORIALS : ACCESSORIALS;
  const selectedAccessorials = activeAccessorials.filter(a => accessorialOptions.some(o => o.value === a));

  // What the API receives: only options valid for this shipment type, with the signature type.
  function accessorialsForRequest() {
    if (!isParcelType) return selectedAccessorials;
    return selectedAccessorials.map(a => (a === 'signature' ? signatureType : a === 'home_delivery' ? homeDeliveryType : a));
  }
  const parcelHas = a => isParcelType && selectedAccessorials.includes(a);

  function toggleAccessorial(val) {
    const turningOn = !activeAccessorials.includes(val);
    setActiveAccessorials(prev =>
      prev.includes(val) ? prev.filter(a => a !== val) : [...prev, val]
    );
    // Saturday pickup needs a Saturday pickup date — move it to the next Saturday.
    if (val === 'saturday_pickup' && turningOn) {
      if (currentType === 'envelope') setPickupEnv(nextSaturday(pickupEnv || today));
      if (currentType === 'parcel') setPickupParcel(nextSaturday(pickupParcel || today));
    }
  }

  // LTL freight class from density — uses the same default pallet size the request falls back to.
  const autoFreightClass = estimateFreightClass({
    weight: weightLtl, pieces: piecesLtl,
    length: dimLLtl || 48, width: dimWLtl || 40, height: dimHLtl || 48,
  });

  function getFields() {
    if (currentType === 'envelope') return { weight: parseFloat(weightEnv) || 0, pieces: parseInt(piecesEnv) || 1, pickupDate: pickupEnv, currency: currencyEnv, dimL: 12, dimW: 9, dimH: 1, freightClass: '50' };
    if (currentType === 'parcel') return { weight: parseFloat(weightParcel) || 0, pieces: parseInt(piecesParcel) || 1, pickupDate: pickupParcel, currency: currencyParcel, dimL: dimLParcel || 12, dimW: dimWParcel || 12, dimH: dimHParcel || 12, freightClass: '70' };
    return { weight: parseFloat(weightLtl) || 0, pieces: parseInt(piecesLtl) || 1, pickupDate: pickupLtl, currency: currencyLtl, dimL: dimLLtl || 48, dimW: dimWLtl || 40, dimH: dimHLtl || 48, freightClass: freightClassAuto ? (autoFreightClass?.freightClass || '') : freightClass };
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
    setOriginValidation(null);
    setDestValidation(null);

    // Validate addresses via FedEx before fetching rates
    setValidating(true);
    try {
      const [origResult, destResult] = await Promise.all([
        fetchAPI('/api/address-validation', {
          method: 'POST',
          body: JSON.stringify({
            streetLines: [origCity.trim() || origPostal.trim()],
            city: origCity.trim() || 'Unknown',
            postalCode: origPostal.trim().replace(/\s/g, '') || '00000',
            countryCode: origCountry,
          }),
        }).catch(() => ({ valid: null, fallback: true })),
        fetchAPI('/api/address-validation', {
          method: 'POST',
          body: JSON.stringify({
            streetLines: [destCity.trim() || destPostal.trim()],
            city: destCity.trim() || 'Unknown',
            postalCode: destPostal.trim().replace(/\s/g, '') || '00000',
            countryCode: destCountry,
          }),
        }).catch(() => ({ valid: null, fallback: true })),
      ]);
      setOriginValidation(origResult);
      setDestValidation(destResult);

      // Block if either address is explicitly invalid (but allow fallback/unavailable)
      if (origResult.valid === false || destResult.valid === false) {
        setValidating(false);
        setLoading(false);
        return;
      }
    } catch {
      // If validation fails entirely, continue with quotes (don't block on FedEx downtime)
    }
    setValidating(false);

    await new Promise(r => setTimeout(r, 900));

    let quoteResults;
    let quotedRequest = null; // what was quoted — the booking step needs it
    try {
      const body = {
        shipmentType: currentType,
        origin: {
          city: origCity.trim() || undefined,
          province: origProvince.trim() || undefined,
          postalCode: origPostal.trim().replace(/\s/g, '') || undefined,
          country: origCountry,
        },
        destination: {
          city: destCity.trim() || undefined,
          province: destProvince.trim() || undefined,
          postalCode: destPostal.trim().replace(/\s/g, '') || undefined,
          country: destCountry,
        },
        weight,
        pieces,
        ...(dimL && dimW && dimH && { dimensions: { length: parseInt(dimL), width: parseInt(dimW), height: parseInt(dimH) } }),
        freightClass: fc || undefined, // backend calculates it from density when missing
        currency,
        ...(pickupDate && { pickupDate }),
        ...(declaredValue && { declaredValue: parseFloat(declaredValue) }),
        ...(selectedAccessorials.length && { accessorials: accessorialsForRequest() }),
        ...(parcelHas('hazmat') && { dgType }),
        ...(parcelHas('hazmat') && dgType === 'BATTERY' && { battery: { material: batteryMaterial, packing: batteryPacking } }),
        ...(parcelHas('home_delivery') && homeDeliveryType === 'date_certain' && homeDeliveryDate && { homeDeliveryDate }),
        ...(currentType === 'parcel' && fedexPackaging !== 'YOUR_PACKAGING' && { fedexPackaging, fedexOneRate }),
      };
      quotedRequest = { shipmentType: currentType, accessorials: body.accessorials || [], dgType: body.dgType, origin: body.origin, destination: body.destination };
      const data = await fetchAPI('/api/rate/all', { method: 'POST', body: JSON.stringify(body) });
      // A successful response — even with zero rates — is the real, honest answer (no carrier
      // has a live rate for this route/shipment right now). Only a thrown error (network issue,
      // backend unreachable) should fall through to client-side simulation below; an empty
      // `rates: []` must NOT be treated the same as a failed request, or every genuinely-empty
      // result gets silently replaced with fabricated data.
      quoteResults = (data.rates || []).map(r => ({
        carrier: CARRIERS.find(c => c.id === r.carrierId) || CARRIERS[0],
        displayRate: r.displayRate,
        currency: r.currency || 'CAD', // each rate is in its carrier's own currency
        transitDays: r.transitDays,
        deliveryDate: r.deliveryDate || calcDelivery(r.transitDays, pickupDate),
        service: r.serviceName,
        live: r.isLiveRate || false,
        quoteId: r.quoteId,
        quoteRateId: r.quoteRateId,
      }));
    } catch {
      // Fallback to client-side simulation — only reached when the request itself failed
      // (backend unreachable), not when it succeeded with zero live rates.
    }

    if (!quoteResults) {
      // Filter carriers by shipment type (CSA is LTL-only, DHL is envelope/parcel only)
      const LTL_ONLY = ['csa', 'xpo', 'manitoulin', 'polaris'];
      const NO_LTL = ['dhl'];
      const eligible = CARRIERS.filter(c => {
        if (currentType === 'ltl' && NO_LTL.includes(c.id)) return false;
        if (currentType !== 'ltl' && LTL_ONLY.includes(c.id)) return false;
        return true;
      });
      quoteResults = eligible.map(c => {
        const sim = simulateRate(c, currentType, weight, fc, orig, dest, selectedAccessorials, pickupDate);
        return { carrier: c, ...sim, currency: getFields().currency, displayRate: Math.round(applyMarkup(sim.rate) * 100) / 100 };
      });
      quoteResults.sort((a, b) => a.displayRate - b.displayRate);
    }
    // Live results keep the server's order: it ranks across CAD and USD rates on a common
    // basis, which a raw price sort here can't do.
    setResults({ request: quotedRequest, quotes: quoteResults, summary: { count: quoteResults.length, orig: origCity || origPostal, dest: destCity || destPostal, type: { envelope: 'Envelope', parcel: 'Parcel', ltl: 'LTL Freight' }[currentType], weight, currency: getFields().currency } });
    setLoading(false);
  }

  const FORM_COUNTRIES = ['CA', 'US', 'CN', 'GB', 'DE'];
  function applyAddress(side, a) {
    const country = FORM_COUNTRIES.includes(a.country) ? a.country : 'other';
    if (side === 'origin') {
      setOrigCity(a.city || ''); setOrigProvince(a.province || ''); setOrigPostal(a.postalCode || ''); setOrigCountry(country);
      setOriginValidation(null);
    } else {
      setDestCity(a.city || ''); setDestProvince(a.province || ''); setDestPostal(a.postalCode || ''); setDestCountry(country);
      setDestValidation(null);
    }
  }

  async function handleBook(r, details) {
    if (!r.quoteId || !r.quoteRateId) return;
    setBooking(prev => ({ ...prev, [r.quoteRateId]: 'loading' }));
    try {
      const data = await fetchAPI('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ quoteId: r.quoteId, quoteRateId: r.quoteRateId, ...details }),
      });
      setBooking(prev => ({ ...prev, [r.quoteRateId]: 'booked' }));
      if (data.label?.encodedLabel) {
        setLabels(prev => ({ ...prev, [r.quoteRateId]: {
          encodedLabel: data.label.encodedLabel,
          docType: data.label.docType || 'PDF',
          trackingNumber: data.carrierTrackingNumber || data.shipment.trackingNumber,
        }}));
      }
      const tracking = data.carrierTrackingNumber
        ? `${data.carrierTrackingNumber} (carrier) / ${data.shipment.trackingNumber} (IFF)`
        : data.shipment.trackingNumber;
      let msg = data.booking.paymentStatus === 'paid'
        ? `Booked & paid! Booking ${data.booking.bookingNumber} — tracking: ${tracking}`
        : `Booked! Booking ${data.booking.bookingNumber} — tracking: ${tracking}. Invoice will be sent.`;
      if (data.manualCarrierBooking?.reason) msg += `\n\n${data.manualCarrierBooking.reason}`;
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

  function downloadLabel(quoteRateId) {
    const lbl = labels[quoteRateId];
    if (!lbl) return;
    const extMap = { PDF: 'pdf', PNG: 'png', ZPLII: 'zpl' };
    const mimeMap = { PDF: 'application/pdf', PNG: 'image/png', ZPLII: 'text/plain' };
    const ext = extMap[lbl.docType] || 'bin';
    const mime = mimeMap[lbl.docType] || 'application/octet-stream';
    const a = document.createElement('a');
    a.href = `data:${mime};base64,${lbl.encodedLabel}`;
    a.download = `label_${lbl.trackingNumber}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handleTypeChange(type) {
    setCurrentType(type);
    setResults(null);
    setSpotSuccess(false);
    setOriginValidation(null);
    setDestValidation(null);
  }

  return (
    <div className="section-card">
      {/* Shipment type selector */}
      <div className={s.sectionLabel}>Select shipment type</div>
      <div className={s.typeGrid}>
        <div className={`${s.typeCard} ${currentType === 'envelope' ? s.active : ''}`} onClick={() => handleTypeChange('envelope')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="m2 6 10 8 10-8"/></svg>
          <div className={s.typeLabel}>Envelope</div>
          <div className={s.typeSub}>Letters, documents</div>
          <span className={`${s.typeTag} ${s.tagInstant}`}>&#9889; Instant quote</span>
        </div>
        <div className={`${s.typeCard} ${currentType === 'parcel' ? s.active : ''}`} onClick={() => handleTypeChange('parcel')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <div className={s.typeLabel}>Parcel</div>
          <div className={s.typeSub}>Boxes, packages</div>
          <span className={`${s.typeTag} ${s.tagInstant}`}>&#9889; Instant quote</span>
        </div>
        <div className={`${s.typeCard} ${currentType === 'ltl' ? s.active : ''}`} onClick={() => handleTypeChange('ltl')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
          <div className={s.typeLabel}>LTL Freight</div>
          <div className={s.typeSub}>Pallets, less-than-truckload</div>
          <span className={`${s.typeTag} ${s.tagInstant}`}>&#9889; Instant quote</span>
        </div>
        <div className={`${s.typeCard} ${s.spotType} ${currentType === 'ftl' ? s.active : ''}`} onClick={() => handleTypeChange('ftl')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 17H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="9" y="11" width="14" height="10" rx="1"/><circle cx="12" cy="21" r="1"/><circle cx="20" cy="21" r="1"/></svg>
          <div className={s.typeLabel}>FTL Freight</div>
          <div className={s.typeSub}>Full truckload</div>
          <span className={`${s.typeTag} ${s.tagSpot}`}>&#9993; Spot rate</span>
        </div>
        <div className={`${s.typeCard} ${s.spotType} ${currentType === 'air' ? s.active : ''}`} onClick={() => handleTypeChange('air')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>
          <div className={s.typeLabel}>Air Freight</div>
          <div className={s.typeSub}>Import &amp; export</div>
          <span className={`${s.typeTag} ${s.tagSpot}`}>&#9993; Spot rate</span>
        </div>
        <div className={`${s.typeCard} ${s.spotType} ${currentType === 'ocean' ? s.active : ''}`} onClick={() => handleTypeChange('ocean')}>
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
          <AddressAutocomplete label="Search pickup address" placeholder="Start typing an address or postal code" onSelect={a => applyAddress('origin', a)} />
          <div className="grid2">
            <div className="field"><label>City</label><input placeholder="e.g. Toronto" value={origCity} onChange={e => { setOrigCity(e.target.value); setOriginValidation(null); }} /></div>
            <div className="field"><label>Province / State</label><input placeholder="e.g. ON" value={origProvince} onChange={e => { setOrigProvince(e.target.value); setOriginValidation(null); }} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>Postal / ZIP</label><input placeholder="M5V 3A8" value={origPostal} onChange={e => { setOrigPostal(e.target.value); setOriginValidation(null); }} /></div>
            <div className="field"><label>Country</label>
              <select value={origCountry} onChange={e => { setOrigCountry(e.target.value); setOriginValidation(null); }}>
                <option value="CA">Canada</option><option value="US">USA</option><option value="CN">China</option><option value="GB">UK</option><option value="DE">Germany</option><option value="other">Other</option>
              </select>
            </div>
          </div>
          {originValidation && originValidation.valid === true && (
            <div className={s.validationOk}>&#10003; Origin address verified{originValidation.classification !== 'UNKNOWN' ? ` (${originValidation.classification.toLowerCase()})` : ''}</div>
          )}
          {originValidation && originValidation.valid === false && originValidation.effectiveAddress ? (
            <div className={s.validationSuggestion}>
              Origin address could not be verified as entered.
              <strong>Suggested: {originValidation.effectiveAddress.city}{originValidation.effectiveAddress.stateOrProvinceCode ? `, ${originValidation.effectiveAddress.stateOrProvinceCode}` : ''} {originValidation.effectiveAddress.postalCode}</strong>
              <button className={s.btnAcceptSuggestion} onClick={() => {
                setOrigCity(originValidation.effectiveAddress.city || origCity);
                if (originValidation.effectiveAddress.stateOrProvinceCode) setOrigProvince(originValidation.effectiveAddress.stateOrProvinceCode);
                setOrigPostal(originValidation.effectiveAddress.postalCode || origPostal);
                setOriginValidation({ ...originValidation, valid: true });
              }}>Accept suggestion</button>
            </div>
          ) : originValidation && originValidation.valid === false ? (
            <div className={s.validationError}>&#10007; Origin address could not be validated. Please check city and postal code.</div>
          ) : null}
        </div>
        <div>
          <div className={s.colLabel}>Destination</div>
          <AddressAutocomplete label="Search delivery address" placeholder="Start typing an address or postal code" onSelect={a => applyAddress('destination', a)} />
          <div className="grid2">
            <div className="field"><label>City</label><input placeholder="e.g. Chicago" value={destCity} onChange={e => { setDestCity(e.target.value); setDestValidation(null); }} /></div>
            <div className="field"><label>Province / State</label><input placeholder="e.g. IL" value={destProvince} onChange={e => { setDestProvince(e.target.value); setDestValidation(null); }} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>Postal / ZIP</label><input placeholder="60601" value={destPostal} onChange={e => { setDestPostal(e.target.value); setDestValidation(null); }} /></div>
            <div className="field"><label>Country</label>
              <select value={destCountry} onChange={e => { setDestCountry(e.target.value); setDestValidation(null); }}>
                <option value="US">USA</option><option value="CA">Canada</option><option value="CN">China</option><option value="GB">UK</option><option value="DE">Germany</option><option value="other">Other</option>
              </select>
            </div>
          </div>
          {destValidation && destValidation.valid === true && (
            <div className={s.validationOk}>&#10003; Destination address verified{destValidation.classification !== 'UNKNOWN' ? ` (${destValidation.classification.toLowerCase()})` : ''}</div>
          )}
          {destValidation && destValidation.valid === false && destValidation.effectiveAddress ? (
            <div className={s.validationSuggestion}>
              Destination address could not be verified as entered.
              <strong>Suggested: {destValidation.effectiveAddress.city}{destValidation.effectiveAddress.stateOrProvinceCode ? `, ${destValidation.effectiveAddress.stateOrProvinceCode}` : ''} {destValidation.effectiveAddress.postalCode}</strong>
              <button className={s.btnAcceptSuggestion} onClick={() => {
                setDestCity(destValidation.effectiveAddress.city || destCity);
                if (destValidation.effectiveAddress.stateOrProvinceCode) setDestProvince(destValidation.effectiveAddress.stateOrProvinceCode);
                setDestPostal(destValidation.effectiveAddress.postalCode || destPostal);
                setDestValidation({ ...destValidation, valid: true });
              }}>Accept suggestion</button>
            </div>
          ) : destValidation && destValidation.valid === false ? (
            <div className={s.validationError}>&#10007; Destination address could not be validated. Please check city and postal code.</div>
          ) : null}
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
              <div className="grid3" style={{ marginTop: '10px' }}>
                <div className="field">
                  <label>FedEx packaging</label>
                  <select value={fedexPackaging} onChange={e => { setFedexPackaging(e.target.value); if (e.target.value === 'YOUR_PACKAGING') setFedexOneRate(false); }}>
                    <option value="YOUR_PACKAGING">My own packaging</option>
                    <option value="FEDEX_ENVELOPE">FedEx® Envelope</option>
                    <option value="FEDEX_PAK">FedEx® Pak</option>
                    <option value="FEDEX_TUBE">FedEx® Tube</option>
                    <option value="FEDEX_SMALL_BOX">FedEx® Small Box</option>
                    <option value="FEDEX_MEDIUM_BOX">FedEx® Medium Box</option>
                    <option value="FEDEX_LARGE_BOX">FedEx® Large Box</option>
                    <option value="FEDEX_EXTRA_LARGE_BOX">FedEx® Extra Large Box</option>
                  </select>
                </div>
                <label className="field" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 22, opacity: fedexPackaging === 'YOUR_PACKAGING' ? 0.5 : 1 }}>
                  <input type="checkbox" style={{ width: 18, height: 18, padding: 0, appearance: 'auto', WebkitAppearance: 'checkbox', accentColor: 'var(--navy)', cursor: 'pointer' }} checked={fedexOneRate} disabled={fedexPackaging === 'YOUR_PACKAGING'} onChange={e => setFedexOneRate(e.target.checked)} />
                  <span style={{ fontSize: 13 }}>FedEx One Rate® <span style={{ color: 'var(--text3)', fontSize: 11 }}>(US domestic only)</span></span>
                </label>
              </div>
            </div>
          )}

          {currentType === 'ltl' && (
            <div style={{ marginBottom: '14px' }}>
              <div className="grid4" style={{ marginBottom: '10px' }}>
                <div className="field"><label>Weight (lbs)</label><input type="number" placeholder="500" min="1" value={weightLtl} onChange={e => setWeightLtl(e.target.value)} /></div>
                <div className="field"><label>Pieces</label><input type="number" value={piecesLtl} min="1" onChange={e => setPiecesLtl(e.target.value)} /></div>
                <div className="field"><label>Freight class</label>
                  <select
                    value={freightClassAuto ? 'auto' : freightClass}
                    onChange={e => {
                      if (e.target.value === 'auto') { setFreightClassAuto(true); return; }
                      setFreightClassAuto(false);
                      setFreightClass(e.target.value);
                    }}
                  >
                    <option value="auto">{autoFreightClass ? `Auto — class ${autoFreightClass.freightClass}` : 'Auto (enter weight)'}</option>
                    {FREIGHT_CLASSES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {freightClassAuto && autoFreightClass && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                      {autoFreightClass.density} lb/ft³ density{!(dimLLtl && dimWLtl && dimHLtl) ? ' (using 48×40×48 in pallet — enter dimensions for accuracy)' : ''}
                    </div>
                  )}
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
            <div className="field"><label>Declared value ($)</label><input type="number" placeholder="Optional" value={declaredValue} onChange={e => setDeclaredValue(e.target.value)} />
              {isParcelType && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Extends the carrier&apos;s liability to this value; carriers may add a charge.</div>}
            </div>
            <div className="field"><label>Commodity</label><input placeholder="e.g. Auto parts" value={commodity} onChange={e => setCommodity(e.target.value)} /></div>
          </div>

          <div className={s.sectionLabel}>Accessorials</div>
          <div className={s.accGrid}>
            {accessorialOptions.map(acc => (
              <div
                key={acc.value}
                className={`${s.accItem} ${activeAccessorials.includes(acc.value) ? s.accItemActive : ''}`}
                onClick={() => toggleAccessorial(acc.value)}
                title={acc.hint}
              >
                {acc.label}
              </div>
            ))}
          </div>

          {(parcelHas('signature') || parcelHas('home_delivery') || parcelHas('hazmat')) && (
            <div className="grid2" style={{ margin: '10px 0 4px' }}>
              {parcelHas('signature') && (
                <div className="field"><label>Signature type</label>
                  <select value={signatureType} onChange={e => setSignatureType(e.target.value)}>
                    {SIGNATURE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              )}
              {parcelHas('home_delivery') && (
                <div className="field"><label>Home delivery option</label>
                  <select value={homeDeliveryType} onChange={e => setHomeDeliveryType(e.target.value)}>
                    {HOME_DELIVERY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {homeDeliveryType === 'date_certain' && (
                    <input type="date" style={{ marginTop: 6 }} min={getFields().pickupDate || today} value={homeDeliveryDate} onChange={e => setHomeDeliveryDate(e.target.value)} />
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>FedEx Home Delivery® option, for US residential deliveries only.</div>
                </div>
              )}
              {parcelHas('hazmat') && (
                <div className="field"><label>Dangerous goods type</label>
                  <select value={dgType} onChange={e => setDgType(e.target.value)}>
                    {DG_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {dgType === 'BATTERY' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <select value={batteryMaterial} onChange={e => setBatteryMaterial(e.target.value)}>
                        <option value="LITHIUM_ION">Lithium ion</option>
                        <option value="LITHIUM_METAL">Lithium metal</option>
                      </select>
                      <select value={batteryPacking} onChange={e => setBatteryPacking(e.target.value)}>
                        <option value="CONTAINED_IN_EQUIPMENT">Contained in equipment</option>
                        <option value="PACKED_WITH_EQUIPMENT">Packed with equipment</option>
                      </select>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Class and UN number are entered when the shipment is booked.</div>
                </div>
              )}
            </div>
          )}
          {parcelHas('saturday_pickup') && (
            <div style={{ fontSize: 11, color: 'var(--text3)', margin: '6px 0 0' }}>
              Saturday pickup needs a Saturday pickup date; carriers that can&apos;t pick up on that day won&apos;t be shown.
            </div>
          )}

          <button className={s.btnQuote} onClick={getQuotes} disabled={loading || validating}>
            {validating ? (
              <><span className="spinner" /> Validating addresses&hellip;</>
            ) : loading ? (
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
            <textarea rows="3" placeholder="Dangerous goods class, temperature controlled, fragile, customs brokerage needed, declared value, etc." value={spotNotes} onChange={e => setSpotNotes(e.target.value)} />
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
            {results.summary.count} quotes &middot; {results.summary.orig} &rarr; {results.summary.dest} &middot; {results.summary.type} &middot; {results.summary.weight} lbs
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>All rates shown are estimates and may be subject to adjustment based on actual shipment weight, dimensions, and carrier surcharges.</div>
          {results.quotes.length === 0 && (
            <div style={{ background: 'var(--off-white)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 20px', color: 'var(--text2)', fontSize: 13 }}>
              No live carrier rates are available for this route right now. Try adjusting the shipment details, or submit a spot rate request and our team will get back to you.
            </div>
          )}
          {results.quotes.map((r, i) => {
            const isBest = i === 0;
            const best = results.quotes[0];
            // "vs best" only makes sense against a rate in the same currency.
            const savings = i > 0 && r.currency === best.currency ? (r.displayRate - best.displayRate).toFixed(2) : null;
            const sym = r.currency === 'USD' ? 'US$' : 'C$';
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
                  {r.carrier.id === 'fedex' && <div style={{ ...FEDEX_DISCLAIMER_STYLE, marginTop: 6 }}>{FEDEX_DISCLAIMER}</div>}
                  {r.carrier.id === 'dhl' && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{DHL_DISCLAIMER}</div>}
                </div>
                <div className={s.rr}>
                  <div className={s.rrAmount}>{sym}{r.displayRate.toFixed(2)}</div>
                  <div className={s.rrCur}>{r.currency}</div>
                  {!isBest && savings !== null && <div className={s.rrSavings}>+${savings} vs best</div>}
                  <button
                    className={s.btnBook}
                    disabled={!canBook || bookState === 'loading' || bookState === 'booked'}
                    onClick={() => setConfirmRate(r)}
                    title={!canBook ? 'Sign in to book this rate' : undefined}
                  >
                    {bookState === 'loading' ? 'Booking…' : bookState === 'booked' ? 'Booked ✓' : canBook ? 'Book this rate →' : 'Sign in to book'}
                  </button>
                  {bookState === 'booked' && labels[r.quoteRateId] && (
                    <button className={s.btnLabel} onClick={() => downloadLabel(r.quoteRateId)}>
                      Download Label ({labels[r.quoteRateId].docType})
                    </button>
                  )}
                  {bookState === 'booked' && !labels[r.quoteRateId] && r.carrier.id === 'csa' && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>CSA does not provide shipping labels via API</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {confirmRate && (
        <BookingModal
          rate={confirmRate}
          request={results?.request}
          onCancel={() => setConfirmRate(null)}
          onConfirm={(details) => { const r = confirmRate; setConfirmRate(null); handleBook(r, details); }}
        />
      )}
    </div>
  );
}
