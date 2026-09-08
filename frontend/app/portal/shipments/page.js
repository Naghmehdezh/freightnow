'use client';
import { useState, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { fetchAPI } from '@/lib/api';
import s from './page.module.css';

const DEMO_SHIPMENTS = [
  { id: 'IFF-2026-00341', bookingNumber: 'BK-2026-0012', tracking: '1Z999AA1234567890', route: 'Toronto → Chicago', carrier: 'FedEx Freight', type: 'LTL', weight: '500 lbs', booked: 'May 20', delivery: 'May 24', cost: 'C$312.40', status: 'delivered', origin: 'Toronto, ON M5V 3A8', dest: 'Chicago, IL 60601', pieces: '2 pallets', service: 'Freight Economy' },
  { id: 'IFF-2026-00340', bookingNumber: 'BK-2026-0011', tracking: '7489234572834', route: 'Toronto → New York', carrier: 'XPO Logistics', type: 'LTL', weight: '320 lbs', booked: 'May 18', delivery: 'May 22', cost: 'C$228.75', status: 'delivered', origin: 'Toronto, ON M5V 3A8', dest: 'New York, NY 10001', pieces: '1 pallet', service: 'Standard LTL' },
  { id: 'IFF-2026-00339', bookingNumber: 'BK-2026-0010', tracking: '1Z888BB9876543210', route: 'Mississauga → Detroit', carrier: 'Day & Ross', type: 'Parcel', weight: '180 lbs', booked: 'May 22', delivery: 'May 26', cost: 'C$185.60', status: 'in_transit', origin: 'Mississauga, ON L5B 3C2', dest: 'Detroit, MI 48201', pieces: '3 boxes', service: 'Freight Priority' },
  { id: 'IFF-2026-00338', bookingNumber: 'BK-2026-0009', tracking: 'MAN-2026-00481', route: 'Toronto → Montreal', carrier: 'Manitoulin', type: 'LTL', weight: '240 lbs', booked: 'May 23', delivery: 'May 27', cost: 'C$142.30', status: 'in_transit', origin: 'Toronto, ON M5V 3A8', dest: 'Montreal, QC H2Y 1C6', pieces: '2 boxes', service: 'Standard LTL' },
  { id: 'IFF-2026-00337', bookingNumber: 'BK-2026-0008', tracking: 'POL-2026-00192', route: 'Brampton → Ottawa', carrier: 'Polaris', type: 'Parcel', weight: '45 lbs', booked: 'May 25', delivery: 'May 27', cost: 'C$98.50', status: 'pending', origin: 'Brampton, ON L6T 5R3', dest: 'Ottawa, ON K1A 0B1', pieces: '1 box', service: 'Ground' },
  { id: 'IFF-2026-00336', bookingNumber: 'BK-2026-0007', tracking: 'FX-2026-00891', route: 'Toronto → Vancouver', carrier: 'FedEx Freight', type: 'LTL', weight: '780 lbs', booked: 'May 15', delivery: 'May 21', cost: 'C$486.90', status: 'delivered', origin: 'Toronto, ON M5V 3A8', dest: 'Vancouver, BC V6B 1A1', pieces: '4 pallets', service: 'Freight Economy' },
  { id: 'IFF-2026-00335', bookingNumber: 'BK-2026-0006', tracking: 'XPO-2026-00442', route: 'Hamilton → Boston', carrier: 'XPO Logistics', type: 'LTL', weight: '600 lbs', booked: 'May 12', delivery: 'May 16', cost: 'C$345.20', status: 'delivered', origin: 'Hamilton, ON L8P 1A1', dest: 'Boston, MA 02101', pieces: '3 pallets', service: 'Express LTL' },
];

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

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState(DEMO_SHIPMENTS);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);
  const [labelLoading, setLabelLoading] = useState({});

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

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAPI('/api/shipments');
        if (data.shipments?.length) setShipments(data.shipments);
      } catch {}
    }
    load();
  }, []);

  const filtered = shipments.filter(ship => {
    const matchStatus = filter === 'all' || ship.status === filter;
    const q = search.toLowerCase();
    const tracking = (ship.tracking || ship.trackingNumber || '').toLowerCase();
    const carrier = (ship.carrier || ship.carrierName || '').toLowerCase();
    const route = (ship.route || `${ship.originCity || ''} ${ship.destCity || ''}`).toLowerCase();
    const bookingNum = (ship.bookingNumber || ship.booking?.bookingNumber || '').toLowerCase();
    const matchSearch = !q || tracking.includes(q) || carrier.includes(q) || route.includes(q) || bookingNum.includes(q);
    return matchStatus && matchSearch;
  });

  function getBadgeClass(status) {
    if (status === 'delivered') return s.badgeDelivered;
    if (status === 'in_transit') return s.badgeTransit;
    if (status === 'pending') return s.badgePending;
    return s.badgeException;
  }

  function getBadgeLabel(status) {
    if (status === 'delivered') return '● Delivered';
    if (status === 'in_transit') return '↦ In transit';
    if (status === 'pending') return '○ Pending';
    return '! Exception';
  }

  return (
    <div className="section-card">
      <div className={s.filters}>
        {['all', 'in_transit', 'delivered', 'pending'].map(f => (
          <button key={f} className={`${s.filterBtn} ${filter === f ? s.filterBtnActive : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'in_transit' ? 'In transit' : f === 'delivered' ? 'Delivered' : 'Pending'}
          </button>
        ))}
        <input className={s.searchInput} placeholder="Search tracking, carrier, route…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className={s.tableWrap}>
        <table>
          <thead>
            <tr><th>Booking #</th><th>Tracking #</th><th>Route</th><th>Carrier</th><th>Type</th><th>Weight</th><th>Booked</th><th>Delivery</th><th>Cost</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan="11" style={{ textAlign: 'center', padding: '40px 14px', color: 'var(--text3)' }}>No shipments found</td></tr>
            )}
            {filtered.map((ship, i) => (
              <Fragment key={ship.id || ship._id || i}>
                <tr>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}>{ship.bookingNumber || ship.booking?.bookingNumber || '—'}</td>
                  <td>{ship.tracking || ship.trackingNumber}</td>
                  <td>{ship.route || `${ship.originCity || ''} → ${ship.destCity || ''}`}</td>
                  <td>{ship.carrier || ship.carrierName}</td>
                  <td>{ship.type || ship.shipmentType}</td>
                  <td>{ship.weight ? `${ship.weight}` : '—'}</td>
                  <td>{ship.booked || ship.bookedAt?.split('T')[0]}</td>
                  <td>{ship.delivery || ship.estimatedDelivery?.split('T')[0] || '—'}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{ship.cost || (ship.booking?.sellRate ? `C$${ship.booking.sellRate.toFixed(2)}` : '—')}</td>
                  <td><span className={`${s.badge} ${getBadgeClass(ship.status)}`}>{getBadgeLabel(ship.status)}</span></td>
                  <td><button className={s.btnAction} onClick={() => setExpandedRow(expandedRow === i ? null : i)}>Details</button></td>
                </tr>
                {expandedRow === i && (
                  <tr className={s.detailRow}>
                    <td colSpan="11">
                      <div className={s.detailInner}>
                        <div><div className={s.detailLabel}>Origin</div><div className={s.detailValue}>{ship.origin || `${ship.originCity || ''}, ${ship.originPostal || ''}`}</div></div>
                        <div><div className={s.detailLabel}>Destination</div><div className={s.detailValue}>{ship.dest || `${ship.destCity || ''}, ${ship.destPostal || ''}`}</div></div>
                        <div><div className={s.detailLabel}>Pieces</div><div className={s.detailValue}>{ship.pieces || ship.pieces}</div><div className={s.detailSub}>{ship.weight ? `${ship.weight} lbs` : '—'}</div></div>
                        <div><div className={s.detailLabel}>Service</div><div className={s.detailValue}>{ship.service || ship.serviceName}</div><div className={s.detailSub}>{ship.carrier || ship.carrierName}</div></div>
                        <div><div className={s.detailLabel}>Cost</div><div className={s.detailValue}>{ship.cost || (ship.booking?.sellRate ? `C$${ship.booking.sellRate.toFixed(2)}` : '—')}</div></div>
                        <div><div className={s.detailLabel}>Booked</div><div className={s.detailValue}>{ship.booked || ship.bookedAt?.split('T')[0]}</div></div>
                        <div><div className={s.detailLabel}>Est. delivery</div><div className={s.detailValue}>{ship.delivery || ship.estimatedDelivery?.split('T')[0] || '—'}</div></div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                          <Link href={`/portal/track?id=${encodeURIComponent(ship.tracking || ship.trackingNumber)}`} className={s.btnTrack}>Track &rarr;</Link>
                          {(ship.labelDocType || ship.labelBase64) && (
                            <button
                              className={s.btnDownload}
                              onClick={() => handleDownloadLabel(ship._id || ship.id)}
                              disabled={labelLoading[ship._id || ship.id]}
                            >
                              {labelLoading[ship._id || ship.id] ? 'Downloading…' : `Download Label (${ship.labelDocType || 'PDF'})`}
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
