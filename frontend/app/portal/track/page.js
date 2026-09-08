'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import s from './page.module.css';

const MOCK_SHIPMENTS = {
  '1Z999AA1234567890': { carrier: 'FedEx Freight', route: 'Toronto, ON → Chicago, IL', delivery: 'May 24, 2026', service: 'Freight Economy', weight: '500 lbs', pieces: '2 pallets', status: 'delivered', events: [
    { event: 'Delivered', location: 'Chicago, IL', time: 'May 24, 2026 · 10:42 AM', done: true, active: false },
    { event: 'Out for delivery', location: 'Chicago, IL', time: 'May 24, 2026 · 7:15 AM', done: true, active: false },
    { event: 'Arrived at destination facility', location: 'Chicago, IL', time: 'May 23, 2026 · 11:30 PM', done: true, active: false },
    { event: 'In transit', location: 'Indianapolis, IN', time: 'May 23, 2026 · 3:20 PM', done: true, active: false },
    { event: 'Departed origin facility', location: 'Toronto, ON', time: 'May 20, 2026 · 6:00 PM', done: true, active: false },
    { event: 'Picked up', location: 'Toronto, ON', time: 'May 20, 2026 · 2:30 PM', done: true, active: false },
  ]},
  '1Z888BB9876543210': { carrier: 'Day & Ross', route: 'Mississauga, ON → Detroit, MI', delivery: 'May 26, 2026', service: 'Freight Priority', weight: '180 lbs', pieces: '3 boxes', status: 'transit', events: [
    { event: 'Delivered', location: 'Detroit, MI', time: 'Estimated May 26, 2026', done: false, active: false },
    { event: 'In transit', location: 'Windsor, ON', time: 'May 25, 2026 · 4:45 AM', done: false, active: true },
    { event: 'Departed origin facility', location: 'Mississauga, ON', time: 'May 22, 2026 · 8:00 PM', done: true, active: false },
    { event: 'Picked up', location: 'Mississauga, ON', time: 'May 22, 2026 · 3:15 PM', done: true, active: false },
  ]},
  'MAN-2026-00481': { carrier: 'Manitoulin Transport', route: 'Toronto, ON → Montreal, QC', delivery: 'May 27, 2026', service: 'Standard LTL', weight: '240 lbs', pieces: '2 boxes', status: 'transit', events: [
    { event: 'Delivered', location: 'Montreal, QC', time: 'Estimated May 27, 2026', done: false, active: false },
    { event: 'In transit', location: 'Kingston, ON', time: 'May 25, 2026 · 9:10 AM', done: false, active: true },
    { event: 'Picked up', location: 'Toronto, ON', time: 'May 23, 2026 · 11:00 AM', done: true, active: false },
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
    if (status === 'delivered') return '✓ Delivered';
    if (status === 'transit' || status === 'in_transit') return '↦ In transit';
    return '○ Pending pickup';
  }

  return (
    <div style={{ maxWidth: '860px' }}>
      <div className="section-card">
        <div className={s.searchRow}>
          <input
            className={s.trackInput}
            placeholder="Enter tracking number (e.g. 1Z999AA1234567890)"
            value={trackingNumber}
            onChange={e => setTrackingNumber(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doTrack()}
          />
          <button className={s.btnTrack} onClick={() => doTrack()}>Track</button>
        </div>
      </div>

      {notFound && (
        <div className="section-card">
          <div className={s.emptyTrack}>
            <p>No shipment found for &ldquo;{trackingNumber}&rdquo;. Please check the number and try again.</p>
          </div>
        </div>
      )}

      {result && (
        <div className="section-card">
          <div className={s.resultHeader}>
            <div>
              <div className={s.trackingNum}>{trackingNumber}</div>
              {result.carrierTrackingNumber && result.carrierTrackingNumber !== trackingNumber && (
                <div className={s.routeLine} style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>Carrier tracking: {result.carrierTrackingNumber}</div>
              )}
              <div className={s.carrierLine}>{result.carrier}</div>
              <div className={s.routeLine}>{result.route}</div>
            </div>
            <div className={`${s.statusBig} ${getStatusClass(result.status)}`}>
              {getStatusLabel(result.status)}
            </div>
          </div>

          <div className={s.infoGrid}>
            <div className={s.infoItem}><label>Est. delivery</label><span>{result.delivery}</span></div>
            <div className={s.infoItem}><label>Service</label><span>{result.service}</span></div>
            <div className={s.infoItem}><label>Weight</label><span>{result.weight}</span></div>
            <div className={s.infoItem}><label>Pieces</label><span>{result.pieces}</span></div>
          </div>

          <div className={s.timelineTitle}>Tracking history</div>
          <div className={s.timeline}>
            {result.events?.map((ev, i) => (
              <div key={i} className={s.timelineItem}>
                <div className={`${s.tlDot} ${ev.done ? s.tlDotDone : ev.active ? s.tlDotActive : ''}`}>
                  {(ev.done || ev.active) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
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
    </div>
  );
}
