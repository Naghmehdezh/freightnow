'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { fetchAPI } from '@/lib/api';
import s from './page.module.css';

export default function DashboardPage() {
  const [stats, setStats] = useState({ shipmentsThisMonth: 12, totalSpent: 4218, inTransit: 3, saved: 681 });
  const [quotes, setQuotes] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [shipments, setShipments] = useState([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [statsData, quotesData, bookingsData, shipmentsData] = await Promise.all([
          fetchAPI('/api/billing/stats').catch(() => null),
          fetchAPI('/api/quotes?limit=5').catch(() => null),
          fetchAPI('/api/bookings?limit=5').catch(() => null),
          fetchAPI('/api/shipments?limit=5').catch(() => null),
        ]);
        if (statsData) setStats(statsData);
        if (quotesData?.quotes) setQuotes(quotesData.quotes);
        if (bookingsData?.bookings) setBookings(bookingsData.bookings);
        if (shipmentsData?.shipments) setShipments(shipmentsData.shipments);
      } catch {}
    }
    loadData();
  }, []);

  const [bookingAction, setBookingAction] = useState({});
  const [labelLoading, setLabelLoading] = useState({});

  function downloadLabelFromBase64(encodedLabel, docType, trackingNumber) {
    const mimeMap = { PDF: 'application/pdf', PNG: 'image/png', ZPLII: 'text/plain' };
    const extMap = { PDF: 'pdf', PNG: 'png', ZPLII: 'zpl' };
    const mime = mimeMap[docType] || 'application/octet-stream';
    const ext = extMap[docType] || 'bin';
    const binary = atob(encodedLabel);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `label_${trackingNumber}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadLabel(shipId) {
    setLabelLoading(prev => ({ ...prev, [shipId]: true }));
    try {
      const data = await fetchAPI(`/api/shipments/${shipId}/label`);
      downloadLabelFromBase64(data.encodedLabel, data.docType, data.trackingNumber);
    } catch {
      alert('Label not available for this shipment.');
    }
    setLabelLoading(prev => ({ ...prev, [shipId]: false }));
  }

  function isQuoteLive(quote) {
    return new Date(quote.expiresAt) > new Date();
  }

  async function handleBook(quote) {
    const bestRate = quote.rates?.[0];
    if (!bestRate) return;
    setBookingAction(prev => ({ ...prev, [bestRate.id]: 'loading' }));
    try {
      const data = await fetchAPI('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ quoteId: quote.id, quoteRateId: bestRate.id }),
      });
      setBookingAction(prev => ({ ...prev, [bestRate.id]: 'booked' }));
      const tracking = data.carrierTrackingNumber || data.shipment.trackingNumber;
      const msg = data.booking.paymentStatus === 'paid'
        ? `Booked & paid! ${data.booking.bookingNumber} — tracking ${tracking}`
        : `Booked! ${data.booking.bookingNumber} — tracking ${tracking}. Invoice will be sent.`;
      if (data.label?.encodedLabel) {
        downloadLabelFromBase64(data.label.encodedLabel, data.label.docType || 'PDF', tracking);
      }
      alert(msg);
    } catch (err) {
      setBookingAction(prev => ({ ...prev, [bestRate.id]: 'error' }));
      alert(err.error?.message || err.message || 'Booking failed');
    }
  }

  function formatQuoteTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // Already formatted string (demo data)
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return `Today, ${d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }


  function getStatusClass(status) {
    if (status === 'delivered') return s.statusDelivered;
    if (status === 'in_transit') return s.statusTransit;
    return s.statusPending;
  }

  function getStatusLabel(status) {
    if (status === 'delivered') return '● Delivered';
    if (status === 'in_transit') return '↦ In transit';
    return '○ Pending pickup';
  }

  function getBookingStatusClass(status) {
    if (status === 'confirmed') return s.statusConfirmed;
    if (status === 'cancelled') return s.statusCancelled;
    return s.statusPending;
  }

  function getBookingStatusLabel(status) {
    if (status === 'confirmed') return '● Confirmed';
    if (status === 'cancelled') return '✕ Cancelled';
    return '○ ' + (status || 'Pending');
  }

  // Fallback demo data
  const demoQuotes = [
    { quoteNumber: 'Q-2026-0091', route: 'Toronto → Chicago', shipmentType: 'LTL Freight', carrier: 'FedEx Freight', service: 'Freight Economy', rate: 'C$312.40', delivery: 'Tue, May 27', quotedAt: 'Today, 9:14 AM', live: true },
    { quoteNumber: 'Q-2026-0090', route: 'Mississauga → Detroit', shipmentType: 'Parcel', carrier: 'Day & Ross', service: 'Express Saver', rate: 'C$48.20', delivery: 'Mon, May 26', quotedAt: 'Today, 8:52 AM', live: true },
    { quoteNumber: 'Q-2026-0089', route: 'Toronto → Montreal', shipmentType: 'Envelope', carrier: 'FedEx', service: 'Priority Overnight', rate: 'C$24.80', delivery: 'Mon, May 26', quotedAt: 'Yesterday, 4:38 PM', live: false },
    { quoteNumber: 'Q-2026-0088', route: 'Brampton → New York', shipmentType: 'LTL Freight', carrier: 'XPO Logistics', service: 'Standard LTL', rate: 'C$228.75', delivery: 'Wed, May 28', quotedAt: 'Yesterday, 2:05 PM', live: false },
    { quoteNumber: 'Q-2026-0087', route: 'Toronto → Ottawa', shipmentType: 'Parcel', carrier: 'Polaris', service: 'Ground', rate: 'C$38.50', delivery: 'Tue, May 27', quotedAt: 'May 23, 11:22 AM', live: false },
  ];

  const demoBookings = [
    { bookingNumber: 'BK-2026-0012', carrier: 'FedEx Freight', service: 'Freight Economy', route: 'Toronto → Chicago', rate: 'C$312.40', bookedAt: 'Today, 9:22 AM', status: 'confirmed' },
    { bookingNumber: 'BK-2026-0011', carrier: 'Day & Ross', service: 'Express Saver', route: 'Mississauga → Detroit', rate: 'C$48.20', bookedAt: 'Yesterday, 3:10 PM', status: 'confirmed' },
    { bookingNumber: 'BK-2026-0010', carrier: 'XPO Logistics', service: 'Standard LTL', route: 'Brampton → New York', rate: 'C$228.75', bookedAt: 'May 23, 2:30 PM', status: 'confirmed' },
  ];

  const demoShipments = [
    { trackingNumber: '1Z999AA1234567890', route: 'Toronto → Chicago', carrier: 'FedEx Freight', service: 'Freight Economy', date: 'May 20', status: 'delivered' },
    { trackingNumber: '7489234572834', route: 'Toronto → New York', carrier: 'XPO Logistics', service: 'Standard LTL', date: 'May 18', status: 'delivered' },
    { trackingNumber: '1Z888BB9876543210', route: 'Mississauga → Detroit', carrier: 'Day & Ross', service: 'Freight Priority', date: 'May 22', status: 'in_transit' },
    { trackingNumber: 'MAN-2026-00481', route: 'Toronto → Montreal', carrier: 'Manitoulin', service: 'Standard LTL', date: 'May 23', status: 'in_transit' },
    { trackingNumber: 'POL-2026-00192', route: 'Brampton → Ottawa', carrier: 'Polaris', service: 'Ground', date: 'May 25', status: 'pending' },
  ];

  const displayQuotes = quotes.length ? quotes : demoQuotes;
  const displayBookings = bookings.length ? bookings : demoBookings;
  const displayShipments = shipments.length ? shipments : demoShipments;

  return (
    <>
      {/* Stats */}
      <div className={s.statsRow}>
        <div className={s.statCard}>
          <div className={s.statLabel}>Shipments this month</div>
          <div className={s.statValue}>{stats.shipmentsThisMonth}</div>
          <div className={`${s.statSub} ${s.statSubUp}`}>&uarr; 3 from last month</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Total spent (CAD)</div>
          <div className={s.statValue}>${stats.totalSpent?.toLocaleString()}</div>
          <div className={s.statSub}>This month</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>In transit</div>
          <div className={s.statValue}>{stats.inTransit}</div>
          <div className={s.statSub}>Active shipments</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Saved vs list rate</div>
          <div className={s.statValue}>${stats.saved}</div>
          <div className={`${s.statSub} ${s.statSubUp}`}>&uarr; With IFF rates</div>
        </div>
      </div>

      {/* Quick action */}
      <div className={s.quickAction}>
        <div className={s.quickActionInner}>
          <div>
            <div className={s.quickActionTitle}>Ready to ship?</div>
            <div className={s.quickActionSub}>Get instant quotes from all carriers — envelope, parcel, LTL, air, ocean and more.</div>
          </div>
          <Link href="/portal/quote" className={s.quickActionBtn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            Get a quote
          </Link>
        </div>
      </div>

      {/* Recent Quotes */}
      <div className="section-card">
        <div className={s.scHeader}>
          <div>
            <div className={s.scTitle}>Recent quotes</div>
            <div className={s.scSub}>Quotes are bookable until end of day they were generated</div>
          </div>
          <Link href="/portal/quote" className={s.scLink}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            New quote
          </Link>
        </div>
        <div className={s.tableWrap}>
          <table>
            <thead>
              <tr><th>Quote #</th><th>Route</th><th>Type</th><th>Best carrier</th><th>Service</th><th>Rate</th><th>Est. delivery</th><th>Quoted at</th><th></th></tr>
            </thead>
            <tbody>
              {displayQuotes.map((q, i) => {
                const bestRate = q.rates?.[0];
                const isLive = q.expiresAt ? isQuoteLive(q) : q.live;
                const isBooked = q.status === 'booked';
                const bookState = bestRate ? bookingAction[bestRate.id] : undefined;
                const route = q.route || `${q.originCity || ''} → ${q.destCity || ''}`;
                const carrier = q.carrier || bestRate?.carrierName || '—';
                const service = q.service || bestRate?.serviceName || '—';
                const rate = q.rate || (bestRate ? `C$${bestRate.displayRate.toFixed(2)}` : '—');
                const delivery = q.delivery || (bestRate?.estimatedDelivery ? new Date(bestRate.estimatedDelivery).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '—');
                const quotedAt = q.quotedAt || (q.createdAt ? formatQuoteTime(q.createdAt) : '—');

                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{q.quoteNumber}</td>
                    <td>{route}</td>
                    <td>{q.shipmentType}</td>
                    <td>{carrier}</td>
                    <td>{service}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{rate}</td>
                    <td>{delivery}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{quotedAt}</td>
                    <td>
                      {isBooked || bookState === 'booked' ? (
                        <button className={s.btnBookQuote} disabled>Booked ✓</button>
                      ) : bestRate && isLive ? (
                        <button
                          className={s.btnBookQuote}
                          disabled={bookState === 'loading'}
                          onClick={() => handleBook(q)}
                        >
                          {bookState === 'loading' ? '…' : 'Book →'}
                        </button>
                      ) : (
                        <button className={s.btnBookQuote} disabled>Expired</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Bookings */}
      <div className="section-card">
        <div className={s.scHeader}>
          <div>
            <div className={s.scTitle}>Recent bookings</div>
            <div className={s.scSub}>Confirmed orders awaiting carrier pickup</div>
          </div>
        </div>
        <div className={s.tableWrap}>
          <table>
            <thead>
              <tr><th>Booking #</th><th>Route</th><th>Carrier</th><th>Service</th><th>Rate</th><th>Booked at</th><th>Status</th></tr>
            </thead>
            <tbody>
              {displayBookings.map((b, i) => {
                const route = b.route || `${b.quote?.originCity || ''} → ${b.quote?.destCity || ''}`;
                const rate = b.rate || (b.sellRate ? `C$${b.sellRate.toFixed(2)}` : '—');
                const bookedAt = b.bookedAt ? formatQuoteTime(b.bookedAt) : '—';

                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{b.bookingNumber}</td>
                    <td>{route}</td>
                    <td>{b.carrierName || b.carrier}</td>
                    <td>{b.serviceName || b.service}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{rate}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{bookedAt}</td>
                    <td><span className={`${s.statusBadge} ${getBookingStatusClass(b.status)}`}>{getBookingStatusLabel(b.status)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Shipments */}
      <div className="section-card">
        <div className={s.scHeader}>
          <div>
            <div className={s.scTitle}>Recent shipments</div>
            <div className={s.scSub}>Tracking and delivery status</div>
          </div>
        </div>
        <div className={s.tableWrap}>
          <table>
            <thead>
              <tr><th>Tracking #</th><th>Route</th><th>Carrier</th><th>Service</th><th>Date</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {displayShipments.map((ship, i) => {
                const shipId = ship._id || ship.id;
                return (
                  <tr key={i}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{ship.trackingNumber}</td>
                    <td>{ship.route || `${ship.originCity || ''} → ${ship.destCity || ''}`}</td>
                    <td>{ship.carrier || ship.carrierName}</td>
                    <td>{ship.service || ship.serviceName}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>{ship.date || ship.bookedAt?.split('T')[0]}</td>
                    <td><span className={`${s.statusBadge} ${getStatusClass(ship.status)}`}>{getStatusLabel(ship.status)}</span></td>
                    <td>
                      {shipId && ship.labelDocType && (
                        <button
                          className={s.btnBookQuote}
                          style={{ background: 'var(--green)' }}
                          onClick={() => handleDownloadLabel(shipId)}
                          disabled={labelLoading[shipId]}
                        >
                          {labelLoading[shipId] ? '…' : 'Label'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
