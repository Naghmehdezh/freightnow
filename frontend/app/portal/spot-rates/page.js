'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchAPI } from '@/lib/api';
import BookingModal from '@/components/BookingModal';
import a from '../admin/pricing/page.module.css';
import s from './page.module.css';

// The customer's spot-rate requests (FTL / air / ocean): status, IFF's price once quoted,
// and booking the price through the normal booking popup.
const STATUS = {
  pending: { label: 'Awaiting IFF', cls: s.badgeAmber },
  quoted: { label: 'Price ready', cls: a.badgeBlue },
  booked: { label: 'Booked', cls: a.badgeGreen },
  declined: { label: 'Declined', cls: s.badgeRed },
  expired: { label: 'Expired', cls: a.badgeGrey },
};
const TYPE = { ftl: 'FTL / PTL', air: 'Air', ocean: 'Ocean' };
const AIR = { pickup: 'IFF pickup', dropoff: 'Drop-off' };

const money = (n, cur) => `${cur === 'USD' ? 'US$' : 'C$'}${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const end = p => [p.port, p.city, p.province, p.country].filter(Boolean).join(', ');
const day = d => (d ? new Date(d).toLocaleDateString('en-CA') : '—');

export default function SpotRatesPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(null); // request being booked
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    setError('');
    fetchAPI('/api/spot-rates?limit=50').then(setData).catch(e => setError(e?.error?.message || e?.message || 'Could not load your requests'));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function book(r, details) {
    setBooking(null);
    setMessage('');
    try {
      const res = await fetchAPI('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ quoteId: r.quoteId, quoteRateId: r.quoteRateId, ...details }),
      });
      setMessage(`Booked! Booking ${res.booking.bookingNumber}, tracking ${res.shipment.trackingNumber}. IFF will confirm pickup with the carrier.`);
      load();
    } catch (e) {
      setError(e?.error?.message || e?.message || 'Could not book this rate');
    }
  }

  return (
    <div className={a.card}>
      <div className={a.cardHead}>
        <div>
          <div className={a.cardTitle}>Spot-rate requests</div>
          <div className={a.sub}>FTL, air and ocean shipments priced by IFF. Book a price once it&apos;s ready.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={a.btnGhost} onClick={load}>↻ Refresh</button>
          <Link href="/portal/quote" className={a.btnPrimary}>New request</Link>
        </div>
      </div>

      {message && <div className={s.successMsg}>{message}</div>}
      {error && <div className={a.error}>{error}</div>}

      <div className={a.tableWrap}>
        <table className={a.table}>
          <thead>
            <tr>
              <th>Request</th>
              <th>Route</th>
              <th>Shipment</th>
              <th>Status</th>
              <th className={a.num}>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.spotRates.map(r => {
              const st = STATUS[r.status] || STATUS.pending;
              return (
                <tr key={r.id}>
                  <td>
                    <div className={a.mono}>{r.requestNumber}</div>
                    <div className={a.small}>{TYPE[r.shipmentType]} · sent {day(r.submittedAt)}</div>
                  </td>
                  <td>
                    <div>{end(r.origin)}</div>
                    <div className={a.small}>→ {end(r.destination)}</div>
                  </td>
                  <td>
                    <div>{r.weight ? `${Number(r.weight).toLocaleString('en-CA')} ${r.weightUnit}` : '—'}{r.skids ? ` · ${r.skids} skids` : r.pieces ? ` · ${r.pieces} pcs` : ''}</div>
                    {r.chargeableWeightKg != null && <div className={a.small}>chargeable {r.chargeableWeightKg} kg</div>}
                    <div className={a.small}>{[AIR[r.airService], r.oceanType, r.commodity].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    <span className={`${a.badge} ${st.cls}`}>{st.label}</span>
                    {r.customerNote && <div className={s.note}>{r.customerNote}</div>}
                  </td>
                  <td className={a.num}>
                    {r.price != null ? (
                      <>
                        <div className={s.price}>{money(r.price, r.currency)}</div>
                        <div className={a.small}>{r.serviceName}{r.transitDays != null ? ` · ${r.transitDays} days` : ''}</div>
                        {r.status === 'quoted' && <div className={a.small}>valid until {day(r.validUntil)}</div>}
                      </>
                    ) : '—'}
                  </td>
                  <td>
                    {r.status === 'quoted' && (
                      <button className={a.btnPrimary} onClick={() => { setError(''); setBooking(r); }}>Book →</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {data && data.spotRates.length === 0 && (
              <tr><td colSpan={6} className={a.empty}>No spot-rate requests yet. Choose FTL, air or ocean on <Link href="/portal/quote">Get a quote</Link> to send one.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {booking && (
        <BookingModal
          rate={{
            carrier: { id: 'iff', name: 'IFF Cargo' },
            service: booking.serviceName,
            displayRate: booking.price,
            currency: booking.currency,
            transitDays: booking.transitDays,
            quoteId: booking.quoteId,
            quoteRateId: booking.quoteRateId,
          }}
          request={{ shipmentType: booking.shipmentType, accessorials: [], origin: booking.origin, destination: booking.destination }}
          onCancel={() => setBooking(null)}
          onConfirm={details => book(booking, details)}
        />
      )}
    </div>
  );
}
