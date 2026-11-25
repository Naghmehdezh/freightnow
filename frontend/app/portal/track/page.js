'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import s from './page.module.css';
import { FEDEX_DISCLAIMER, FEDEX_DISCLAIMER_STYLE } from '@/lib/fedexCompliance';

const MOCK_SHIPMENTS = {
  '1Z999AA1234567890': { carrier: 'FedEx Freight', route: 'Toronto, ON → Chicago, IL', delivery: 'May 24, 2026', service: 'Freight Economy', weight: '500 lbs', pieces: '2 pallets', status: 'delivered', events: [
    { event: 'Delivered', location: 'Chicago, IL', time: 'May 24, 2026 at 10:42 AM', done: true, active: false },
    { event: 'Out for delivery', location: 'Chicago, IL', time: 'May 24, 2026 at 7:15 AM', done: true, active: false },
    { event: 'Arrived at destination facility', location: 'Chicago, IL', time: 'May 23, 2026 at 11:30 PM', done: true, active: false },
    { event: 'In transit', location: 'Indianapolis, IN', time: 'May 23, 2026 at 3:20 PM', done: true, active: false },
    { event: 'Departed origin facility', location: 'Toronto, ON', time: 'May 20, 2026 at 6:00 PM', done: true, active: false },
    { event: 'Picked up', location: 'Toronto, ON', time: 'May 20, 2026 at 2:30 PM', done: true, active: false },
  ]},
  '1Z888BB9876543210': { carrier: 'Day & Ross', route: 'Mississauga, ON → Detroit, MI', delivery: 'May 26, 2026', service: 'Freight Priority', weight: '180 lbs', pieces: '3 boxes', status: 'transit', events: [
    { event: 'Delivered', location: 'Detroit, MI', time: 'Estimated May 26, 2026', done: false, active: false },
    { event: 'In transit', location: 'Windsor, ON', time: 'May 25, 2026 at 4:45 AM', done: false, active: true },
    { event: 'Departed origin facility', location: 'Mississauga, ON', time: 'May 22, 2026 at 8:00 PM', done: true, active: false },
    { event: 'Picked up', location: 'Mississauga, ON', time: 'May 22, 2026 at 3:15 PM', done: true, active: false },
  ]},
  'MAN-2026-00481': { carrier: 'Manitoulin Transport', route: 'Toronto, ON → Montreal, QC', delivery: 'May 27, 2026', service: 'Standard LTL', weight: '240 lbs', pieces: '2 boxes', status: 'transit', events: [
    { event: 'Delivered', location: 'Montreal, QC', time: 'Estimated May 27, 2026', done: false, active: false },
    { event: 'In transit', location: 'Kingston, ON', time: 'May 25, 2026 at 9:10 AM', done: false, active: true },
    { event: 'Picked up', location: 'Toronto, ON', time: 'May 23, 2026 at 11:00 AM', done: true, active: false },
  ]},
  'POL-2026-00192': { carrier: 'Polaris Transport', route: 'Brampton, ON → Ottawa, ON', delivery: 'May 27, 2026', service: 'Ground', weight: '45 lbs', pieces: '1 box', status: 'pending', events: [
    { event: 'Delivered', location: 'Ottawa, ON', time: 'Estimated May 27, 2026', done: false, active: false },
    { event: 'Awaiting pickup', location: 'Brampton, ON', time: 'May 25, 2026', done: false, active: true },
  ]},
};

export default function TrackPage() {
  return (
    <Suspense fallback={null}>
      <TrackPageInner />
    </Suspense>
  );
}

function TrackPageInner() {
  const searchParams = useSearchParams();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [result, setResult] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const id = searchParams.get('id');
    if (id) {
      setTrackingNumber(id);
      doTrack(id);
    }
  }, [searchParams]);

  async function doTrack(num) {
    const val = (num || trackingNumber).trim();
    if (!val) return;
    setNotFound(false);
    setResult(null);

    // Try API first
    try {
      const data = await fetchAPI(`/api/tracking/${encodeURIComponent(val)}`);
      if (data) { setResult(data); return; }
    } catch {}

    // Fallback to mock
    const mock = MOCK_SHIPMENTS[val];
    if (mock) { setResult(mock); }
    else { setNotFound(true); }
  }

  function getStatusClass(status) {
    if (status === 'delivered') return s.statusDelivered;
    if (status === 'transit' || status === 'in_transit') return s.statusTransit;
    return s.statusPending;
  }

  function getStatusLabel(status) {
    if (status === 'delivered') return 'Delivered';
    if (status === 'transit' || status === 'in_transit') return 'In transit';
    return 'Waiting for pickup';
  }

  return (
    <div className={s.page}>
      <div className="section-card">
        <form className={s.searchRow} onSubmit={e => { e.preventDefault(); doTrack(); }} role="search">
          <label htmlFor="tracking-input" className="sr-only">Tracking number</label>
          <input
            id="tracking-input"
            className={s.trackInput}
            placeholder="IFF or carrier tracking number, e.g. IFF-2026-00058"
            value={trackingNumber}
            onChange={e => setTrackingNumber(e.target.value)}
          />
          <button type="submit" className={s.btnTrack}>Track</button>
        </form>
      </div>

      {notFound && (
        <div className="section-card">
          <div className={s.emptyTrack}>
            <p>No shipment matches &ldquo;{trackingNumber}&rdquo;. Check the number and try again.</p>
          </div>
        </div>
      )}

      {result && (
        <div className="section-card">
          <div className={s.resultHeader}>
            <div>
              <div className={`${s.trackingNum} ref`}>{trackingNumber}</div>
              {result.carrierTrackingNumber && result.carrierTrackingNumber !== trackingNumber && (
                <div className={s.routeLine}>Carrier tracking <span className="ref">{result.carrierTrackingNumber}</span></div>
              )}
              <div className={s.carrierLine}>{result.carrier}</div>
              <div className={s.routeLine}>{result.route}</div>
            </div>
            <div className={`${s.statusBig} ${getStatusClass(result.status)}`}>
              {getStatusLabel(result.status)}
            </div>
          </div>

          <div className={s.infoGrid}>
            <div className={s.infoItem}><label>Estimated delivery</label><span>{result.delivery}</span></div>
            <div className={s.infoItem}><label>Service</label><span>{result.service}</span></div>
            <div className={s.infoItem}><label>Weight</label><span>{result.weight}</span></div>
            <div className={s.infoItem}><label>Pieces</label><span>{result.pieces}</span></div>
          </div>

          <div className={s.timelineTitle}>Tracking history</div>
          <div className={s.timeline}>
            {result.events?.map((ev, i) => (
              <div key={i} className={s.timelineItem}>
                <div className={`${s.tlDot} ${ev.done ? s.tlDotDone : ev.active ? s.tlDotActive : ''}`}>
                </div>
                <div className={s.tlContent}>
                  <div className={s.tlEvent}>{ev.event}</div>
                  <div className={s.tlLocation}>{ev.location}</div>
                  <div className={s.tlTime}>{ev.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Required on every screen showing FedEx marks or service names (FedEx Integrator validation). */}
      {result && /fedex/i.test(`${result.carrier} ${result.service}`) && <p style={{ ...FEDEX_DISCLAIMER_STYLE, marginTop: 16 }}>{FEDEX_DISCLAIMER}</p>}
    </div>
  );
}
