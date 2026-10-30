'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import useRole from '@/lib/useRole';
import a from '../pricing/page.module.css';
import s from '../../spot-rates/page.module.css';

// IFF staff: review spot-rate requests (FTL / air / ocean), price them — which gives the
// customer a bookable "IFF Cargo" rate — or decline them.
const STAFF_ROLES = ['iff_staff', 'iff_admin'];
const FILTERS = [
  { id: 'pending', label: 'Needs a price' },
  { id: 'quoted', label: 'Price sent' },
  { id: 'booked', label: 'Booked' },
  { id: 'expired', label: 'Expired' },
  { id: 'declined', label: 'Declined' },
  { id: 'all', label: 'All' },
];
const STATUS = {
  pending: { label: 'Needs a price', cls: s.badgeAmber },
  quoted: { label: 'Price sent', cls: a.badgeBlue },
  booked: { label: 'Booked', cls: a.badgeGreen },
  declined: { label: 'Declined', cls: s.badgeRed },
  expired: { label: 'Expired', cls: a.badgeGrey },
};
const TYPE = { ftl: 'FTL / PTL', air: 'Air', ocean: 'Ocean' };
const AIR = { pickup: 'IFF picks up', dropoff: 'Customer drops off' };
const DEFAULT_SERVICE = { ftl: 'FTL — spot rate', air: 'Air freight — spot rate', ocean: 'Ocean freight — spot rate' };

const money = n => (n == null ? '—' : Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const end = p => [p.port, p.city, p.province, p.postalCode, p.country].filter(Boolean).join(', ');
const day = d => (d ? new Date(d).toLocaleDateString('en-CA') : '—');
const errMsg = e => e?.error?.message || e?.message || 'Something went wrong';

export default function SpotRatesAdminPage() {
  const router = useRouter();
  const { role, loaded } = useRole();
  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // expanded row id
  const [pricing, setPricing] = useState(null);
  const [declining, setDeclining] = useState(null);

  const allowed = STAFF_ROLES.includes(role);
  useEffect(() => { if (loaded && !allowed) router.replace('/portal'); }, [loaded, allowed, router]);

  const load = useCallback(() => {
    if (!allowed) return;
    setError('');
    const params = new URLSearchParams({ status: filter, limit: '50', ...(search && { search }) });
    fetchAPI(`/api/admin/spot-rates?${params}`).then(setData).catch(e => setError(errMsg(e)));
  }, [allowed, filter, search]);
  useEffect(() => { load(); }, [load]);

  if (!loaded || !allowed) return <div className={a.muted}>Loading…</div>;

  return (
    <div className={a.card}>
      <div className={a.cardHead}>
        <div>
          <div className={a.cardTitle}>Spot-rate requests</div>
          <div className={a.sub}>FTL, air and ocean requests from customers. Pricing one gives the customer a bookable IFF Cargo rate.</div>
        </div>
        <button className={a.btnGhost} onClick={load}>↻ Refresh</button>
      </div>

      <div className={a.filters}>
        <div className={a.segmented}>
          {FILTERS.map(f => (
            <button key={f.id} className={filter === f.id ? a.segActive : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <input className={a.input} placeholder="Request # (SPR-…)" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {error && <div className={a.error}>{error}</div>}

      <div className={a.tableWrap}>
        <table className={a.table}>
          <thead>
            <tr>
              <th>Request</th>
              <th>Customer</th>
              <th>Route</th>
              <th>Shipment</th>
              <th>Status</th>
              <th className={a.num}>Price / cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.data.map(r => {
              const st = STATUS[r.status] || STATUS.pending;
              const canPrice = r.status === 'pending' || r.status === 'quoted' || r.status === 'expired';
              return (
                <Fragment key={r.id}>
                  <tr className={a.groupStart}>
                    <td>
                      <button className={a.linkBtn} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '▾' : '▸'} <span className={a.mono}>{r.requestNumber}</span></button>
                      <div className={a.small}>{TYPE[r.shipmentType]} · {day(r.submittedAt)}</div>
                    </td>
                    <td>
                      <div>{r.customer.company || r.customer.name || '—'}</div>
                      <div className={a.small}>{r.customer.email}</div>
                    </td>
                    <td>
                      <div>{end(r.origin)}</div>
                      <div className={a.small}>→ {end(r.destination)}</div>
                    </td>
                    <td>
                      <div>{r.weight ? `${Number(r.weight).toLocaleString('en-CA')} ${r.weightUnit}` : '—'}{r.skids ? ` · ${r.skids} skids` : r.pieces ? ` · ${r.pieces} pcs` : ''}</div>
                      <div className={a.small}>{[AIR[r.airService], r.oceanType].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td><span className={`${a.badge} ${st.cls}`}>{st.label}</span></td>
                    <td className={a.num}>
                      {r.price != null ? (
                        <>
                          <div className={s.price}>{money(r.price)} {r.currency}</div>
                          <div className={a.small}>cost {money(r.carrierCost)} · margin {money(r.price - r.carrierCost)}</div>
                        </>
                      ) : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {canPrice && <button className={a.linkBtn} onClick={() => setPricing(r)}>{r.status === 'pending' ? 'Price' : 'Re-price'}</button>}
                      {canPrice && <> · <button className={a.linkBtn} onClick={() => setDeclining(r)}>Decline</button></>}
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={7}>
                        <div className={a.breakdown}>
                          <div><span>Customer</span><b>{[r.customer.name, r.customer.phone].filter(Boolean).join(' · ') || '—'}</b></div>
                          {(r.origin.port || r.destination.port) && <div><span>Ports</span><b>{r.origin.port || '—'} → {r.destination.port || '—'}</b></div>}
                          {r.oceanType && <div><span>Ocean service</span><b>{r.oceanType}</b></div>}
                          {r.origin.street && <div><span>Pickup address</span><b>{[r.origin.street, r.origin.city, r.origin.province, r.origin.postalCode].filter(Boolean).join(', ')}</b></div>}
                          <div><span>Pieces / dimensions</span><b>{r.packages?.length
                            ? r.packages.map(p => `${p.pieces} × ${p.length}×${p.width}×${p.height} ${p.unit} (${p.volumeWeightKg} kg vol.)`).join('; ')
                            : (r.dimensions || '—')}</b></div>
                          {r.volumeWeightKg != null && <div><span>Volume / chargeable weight</span><b>{r.volumeWeightKg} kg / {r.chargeableWeightKg} kg</b></div>}
                          <div><span>Commodity</span><b>{r.commodity || '—'}</b></div>
                          {r.declaredValue ? <div><span>Declared value</span><b>{money(r.declaredValue)}</b></div> : null}
                          <div><span>Customer notes</span><b>{r.specialNotes || '—'}</b></div>
                          {r.carrierName && <div><span>Carrier used</span><b>{r.carrierName}</b></div>}
                          {r.validUntil && <div><span>Valid until</span><b>{day(r.validUntil)}</b></div>}
                          {r.quoteNumber && <div><span>Quote</span><b>{r.quoteNumber}</b></div>}
                          {r.customerNote && <div><span>Message to customer</span><b>{r.customerNote}</b></div>}
                          {r.staffNote && <div><span>Internal note</span><b>{r.staffNote}</b></div>}
                          {r.quotedBy && <div><span>Handled by</span><b>{r.quotedBy}</b></div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data && data.data.length === 0 && (
              <tr><td colSpan={7} className={a.empty}>No requests here.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pricing && <PriceModal request={pricing} onClose={() => setPricing(null)} onSaved={() => { setPricing(null); load(); }} />}
      {declining && <DeclineModal request={declining} onClose={() => setDeclining(null)} onSaved={() => { setDeclining(null); load(); }} />}
    </div>
  );
}

function PriceModal({ request, onClose, onSaved }) {
  const [form, setForm] = useState({
    carrierCost: request.carrierCost != null ? String(request.carrierCost) : '',
    price: request.price != null ? String(request.price) : '',
    currency: request.currency || (request.origin.country === 'US' ? 'USD' : 'CAD'),
    transitDays: request.transitDays != null ? String(request.transitDays) : '',
    validDays: '7',
    serviceName: request.serviceName || DEFAULT_SERVICE[request.shipmentType] || '',
    carrierName: request.carrierName || '',
    customerNote: request.customerNote || '',
    staffNote: request.staffNote || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const cost = parseFloat(form.carrierCost);
  const price = parseFloat(form.price);
  const margin = cost > 0 && price > 0 ? price - cost : null;
  const markup = cost > 0 && price > 0 ? (price / cost - 1) * 100 : null;
  const valid = cost > 0 && price > 0 && form.transitDays !== '' && parseInt(form.transitDays) >= 0;

  async function save() {
    setSaving(true);
    setError('');
    try {
      await fetchAPI(`/api/admin/spot-rates/${request.id}/quote`, {
        method: 'POST',
        body: JSON.stringify({
          carrierCost: cost,
          price,
          currency: form.currency,
          transitDays: parseInt(form.transitDays),
          validDays: parseInt(form.validDays) || 7,
          ...(form.serviceName.trim() && { serviceName: form.serviceName.trim() }),
          ...(form.carrierName.trim() && { carrierName: form.carrierName.trim() }),
          ...(form.customerNote.trim() && { customerNote: form.customerNote.trim() }),
          ...(form.staffNote.trim() && { staffNote: form.staffNote.trim() }),
        }),
      });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  }

  return (
    <div className={a.overlay} onClick={onClose}>
      <div className={a.modal} onClick={e => e.stopPropagation()}>
        <div className={a.cardTitle}>{request.price != null ? 'Re-price' : 'Price'} {request.requestNumber}</div>
        <div className={a.sub}>{TYPE[request.shipmentType]} · {end(request.origin)} → {end(request.destination)}{request.weight ? ` · ${request.weight} ${request.weightUnit}` : ''}{request.chargeableWeightKg != null ? ` (chargeable ${request.chargeableWeightKg} kg)` : ''}</div>
        {request.price != null && <div className={a.info}>Saving replaces the price the customer was sent.</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className={a.field}>Carrier cost *<input className={a.input} type="number" min="0" step="0.01" value={form.carrierCost} onChange={set('carrierCost')} /></label>
          <label className={a.field}>Price to customer *<input className={a.input} type="number" min="0" step="0.01" value={form.price} onChange={set('price')} /></label>
          <label className={a.field}>Currency
            <select className={a.input} value={form.currency} onChange={set('currency')}><option>CAD</option><option>USD</option></select>
          </label>
          <label className={a.field}>Transit (days) *<input className={a.input} type="number" min="0" value={form.transitDays} onChange={set('transitDays')} /></label>
          <label className={a.field}>Valid for (business days)<input className={a.input} type="number" min="1" max="60" value={form.validDays} onChange={set('validDays')} /></label>
          <label className={a.field}>Service name (customer sees)<input className={a.input} value={form.serviceName} onChange={set('serviceName')} /></label>
        </div>
        <label className={a.field}>Carrier used (internal)<input className={a.input} placeholder="e.g. Bison Transport" value={form.carrierName} onChange={set('carrierName')} /></label>
        <label className={a.field}>Message to customer<input className={a.input} placeholder="e.g. Includes fuel; tailgate extra" value={form.customerNote} onChange={set('customerNote')} maxLength={1000} /></label>
        <label className={a.field}>Internal note<input className={a.input} value={form.staffNote} onChange={set('staffNote')} maxLength={1000} /></label>

        <div className={a.breakdown}>
          <div><span>Gross margin</span><b className={margin < 0 ? a.negative : ''}>{money(margin)} {form.currency}</b></div>
          <div><span>Markup over cost</span><b>{markup == null ? '—' : `${markup.toFixed(1)}%`}</b></div>
        </div>
        {margin < 0 && <div className={a.error}>The price is below the carrier cost.</div>}
        {error && <div className={a.error}>{error}</div>}

        <div className={a.modalActions}>
          <span style={{ flex: 1 }} />
          <button className={a.btnGhost} onClick={onClose}>Cancel</button>
          <button className={a.btnPrimary} disabled={saving || !valid} onClick={save}>{saving ? 'Sending…' : 'Send price to customer'}</button>
        </div>
      </div>
    </div>
  );
}

function DeclineModal({ request, onClose, onSaved }) {
  const [customerNote, setCustomerNote] = useState('');
  const [staffNote, setStaffNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await fetchAPI(`/api/admin/spot-rates/${request.id}/decline`, {
        method: 'POST',
        body: JSON.stringify({
          ...(customerNote.trim() && { customerNote: customerNote.trim() }),
          ...(staffNote.trim() && { staffNote: staffNote.trim() }),
        }),
      });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  }

  return (
    <div className={a.overlay} onClick={onClose}>
      <div className={a.modal} onClick={e => e.stopPropagation()}>
        <div className={a.cardTitle}>Decline {request.requestNumber}</div>
        <div className={a.sub}>The customer is told IFF can&apos;t offer a rate.{request.price != null ? ' The price already sent is withdrawn.' : ''}</div>
        <label className={a.field}>Message to customer<input className={a.input} placeholder="e.g. No capacity on this lane this month" value={customerNote} onChange={e => setCustomerNote(e.target.value)} maxLength={1000} /></label>
        <label className={a.field}>Internal note<input className={a.input} value={staffNote} onChange={e => setStaffNote(e.target.value)} maxLength={1000} /></label>
        {error && <div className={a.error}>{error}</div>}
        <div className={a.modalActions}>
          <span style={{ flex: 1 }} />
          <button className={a.btnGhost} onClick={onClose}>Cancel</button>
          <button className={a.btnPrimary} disabled={saving} onClick={save}>{saving ? 'Declining…' : 'Decline request'}</button>
        </div>
      </div>
    </div>
  );
}
