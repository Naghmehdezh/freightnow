'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import useRole from '@/lib/useRole';
import a from '../pricing/page.module.css';
import s from '../../spot-rates/page.module.css';

// IFF staff: quote requests from visitors without an account ("Continue as guest").
// Staff contact the customer, price it by hand, and track where each request stands.
const STAFF_ROLES = ['iff_staff', 'iff_admin'];
const STATUS = {
  new: { label: 'New', cls: s.badgeAmber },
  contacted: { label: 'Contacted', cls: a.badgeBlue },
  quoted: { label: 'Price sent', cls: a.badgeGreen },
  declined: { label: 'Declined', cls: s.badgeRed },
  closed: { label: 'Closed', cls: a.badgeGrey },
};
const FILTERS = [{ id: 'new', label: 'New' }, { id: 'contacted', label: 'Contacted' }, { id: 'quoted', label: 'Price sent' }, { id: 'declined', label: 'Declined' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }];
// Statuses staff set by hand; "Price sent" and "Declined" come from the Price / Decline actions.
const MANUAL_STATUS = ['new', 'contacted', 'closed'];
const money = n => (n == null ? '—' : Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const DEFAULT_SERVICE = { air: 'Air freight', ocean: 'Ocean freight', land: 'Land freight' };
const MODE = { air: 'Air', ocean: 'Ocean', land: 'Land' };
const VOLUME = { lcl: 'Loose container (LCL)', fcl: 'Full container (FCL)', ltl: 'Less than truckload', ftl: 'Full truckload' };
const TERMS = { unknown: "Don't know", exw: 'Ex Works', fob: 'FOB', cif: 'CIF', cfr: 'C & F', dap: 'DAP', ddp: 'DDP', other: 'Other' };
const END = { door: 'door', terminal: 'terminal / port' };
const day = d => (d ? new Date(d).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const errMsg = e => e?.error?.message || e?.message || 'Something went wrong';

export default function GuestQuotesPage() {
  const router = useRouter();
  const { role, loaded } = useRole();
  const allowed = STAFF_ROLES.includes(role);
  const [filter, setFilter] = useState('new');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [notes, setNotes] = useState({}); // draft staff notes by id
  const [saving, setSaving] = useState(null);
  const [pricing, setPricing] = useState(null);
  const [declining, setDeclining] = useState(null);

  useEffect(() => { if (loaded && !allowed) router.replace('/portal'); }, [loaded, allowed, router]);

  const load = useCallback(() => {
    if (!allowed) return;
    setError('');
    const params = new URLSearchParams({ status: filter, ...(search && { search }) });
    fetchAPI(`/api/admin/guest-quotes?${params}`).then(setData).catch(e => setError(errMsg(e)));
  }, [allowed, filter, search]);
  useEffect(() => { load(); }, [load]);

  async function update(r, body) {
    setSaving(r.id);
    setError('');
    try {
      await fetchAPI(`/api/admin/guest-quotes/${r.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (e) { setError(errMsg(e)); }
    setSaving(null);
  }

  if (!loaded || !allowed) return <div className={a.muted}>Loading…</div>;

  return (
    <div className={a.card}>
      <div className={a.cardHead}>
        <div>
          <div className={a.cardTitle}>Guest quote requests</div>
          <div className={a.sub}>Visitors who asked for a quote without an account. Contact them, send a price, and update the status.</div>
        </div>
        <button className={a.btnGhost} onClick={load}>↻ Refresh</button>
      </div>

      <div className={a.filters}>
        <div className={a.segmented}>
          {FILTERS.map(f => <button key={f.id} className={filter === f.id ? a.segActive : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
        </div>
        <input className={a.input} placeholder="Request #, name, company or email" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {error && <div className={a.error}>{error}</div>}

      <div className={a.tableWrap}>
        <table className={a.table}>
          <thead>
            <tr><th>Request</th><th>Contact</th><th>Route</th><th>Shipment</th><th>Status</th><th className={a.num}>Price / cost</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {data?.data.map(r => {
              const st = STATUS[r.status] || STATUS.new;
              const pieces = (r.items || []).reduce((n, it) => n + (it.quantity || 0), 0);
              return (
                <Fragment key={r.id}>
                  <tr className={a.groupStart}>
                    <td>
                      <button className={a.linkBtn} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '▾' : '▸'} <span className={a.mono}>{r.requestNumber}</span></button>
                      <div className={a.small}>{day(r.submittedAt)}</div>
                    </td>
                    <td>
                      <div>{r.name}{r.company ? ` · ${r.company}` : ''}</div>
                      <div className={a.small}><a href={`mailto:${r.email}`}>{r.email}</a> · <a href={`tel:${r.phone}`}>{r.phone}</a></div>
                    </td>
                    <td>
                      <div>{r.origin} <span className={a.small}>({END[r.originType]})</span></div>
                      <div className={a.small}>→ {r.destination} ({END[r.destinationType]})</div>
                    </td>
                    <td>
                      <div>{MODE[r.mode]}{r.volume ? ` · ${VOLUME[r.volume]}` : ''}</div>
                      <div className={a.small}>{pieces ? `${pieces} item(s)` : 'no item details'}{r.hazardous ? ' · ⚠ hazardous' : ''}</div>
                      {(r.items || []).map((it, i) => (
                        <div key={i} className={a.small}>{it.quantity} × {it.length}×{it.width}×{it.height} {it.dimUnit} · {it.weight} {it.weightUnit} each</div>
                      ))}
                    </td>
                    <td>
                      <span className={`${a.badge} ${st.cls}`}>{st.label}</span>
                      {r.priceExpired && <span className={`${a.badge} ${a.badgeGrey}`}>expired</span>}
                      {r.handledBy && <div className={a.small}>{r.handledBy}</div>}
                    </td>
                    <td className={a.num}>
                      {r.quotedRate != null ? (
                        <>
                          <div className={s.price}>{money(r.quotedRate)} {r.quotedCurrency}</div>
                          <div className={a.small}>cost {money(r.carrierCost)} · margin <span className={r.quotedRate - r.carrierCost < 0 ? a.negative : ''}>{money(r.quotedRate - r.carrierCost)}</span></div>
                          {r.validUntil && <div className={a.small}>valid until {new Date(r.validUntil).toLocaleDateString('en-CA')}</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.status !== 'closed' && <button className={a.linkBtn} onClick={() => setPricing(r)}>{r.quotedRate != null ? 'Re-price' : 'Price'}</button>}
                      {r.status !== 'closed' && r.status !== 'declined' && <> · <button className={a.linkBtn} onClick={() => setDeclining(r)}>Decline</button></>}
                      <div style={{ marginTop: 6 }}>
                        <select className={a.input} value={MANUAL_STATUS.includes(r.status) ? r.status : ''} disabled={saving === r.id} onChange={e => e.target.value && update(r, { status: e.target.value })} aria-label={`Status of ${r.requestNumber}`}>
                          {!MANUAL_STATUS.includes(r.status) && <option value="">{STATUS[r.status]?.label}</option>}
                          {MANUAL_STATUS.map(k => <option key={k} value={k}>{k === 'closed' ? 'Mark closed' : `Mark ${STATUS[k].label.toLowerCase()}`}</option>)}
                        </select>
                      </div>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={7}>
                        <div className={a.breakdown}>
                          <div><span>Items</span><b>{r.items?.length
                            ? r.items.map(it => `${it.quantity} × ${it.length}×${it.width}×${it.height} ${it.dimUnit}, ${it.weight} ${it.weightUnit} each`).join('; ')
                            : 'Not provided — ask the customer'}</b></div>
                          <div><span>Terms of sale</span><b>{TERMS[r.termsOfSale] || '—'}</b></div>
                          <div><span>Hazardous</span><b>{r.hazardous ? 'Yes' : 'No'}</b></div>
                          {r.notes && <div><span>Customer notes</span><b style={{ whiteSpace: 'pre-line' }}>{r.notes}</b></div>}
                          <div><span>Came from</span><b>{r.source === 'home' ? 'Home page quote card' : 'Request a quote page'}</b></div>
                          {r.quotedRate != null && <>
                            <div><span>Price sent</span><b>{money(r.quotedRate)} {r.quotedCurrency}{r.serviceName ? ` · ${r.serviceName}` : ''}{r.transitDays != null ? ` · ${r.transitDays} days` : ''}</b></div>
                            <div><span>Carrier cost · carrier used</span><b>{money(r.carrierCost)} {r.quotedCurrency}{r.carrierName ? ` · ${r.carrierName}` : ''}</b></div>
                            <div><span>Sent by · on</span><b>{r.quotedBy || '—'} · {day(r.quotedAt)}</b></div>
                          </>}
                          {r.declinedAt && <div><span>Declined on</span><b>{day(r.declinedAt)}</b></div>}
                          {r.customerNote && <div><span>Message to customer</span><b>{r.customerNote}</b></div>}
                        </div>
                        <label className={a.field} style={{ marginTop: 10 }}>Staff note (internal)
                          <textarea className={a.input} rows={2} value={notes[r.id] ?? r.staffNote ?? ''} onChange={e => setNotes(n => ({ ...n, [r.id]: e.target.value }))} />
                        </label>
                        <button className={a.btnPrimary} disabled={saving === r.id} onClick={() => update(r, { staffNote: notes[r.id] ?? r.staffNote ?? '' })}>Save note</button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data && data.data.length === 0 && <tr><td colSpan={7} className={a.empty}>No requests here.</td></tr>}
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
    price: request.quotedRate != null ? String(request.quotedRate) : '',
    currency: request.quotedCurrency || 'CAD',
    transitDays: request.transitDays != null ? String(request.transitDays) : '',
    validDays: '7',
    serviceName: request.serviceName || [DEFAULT_SERVICE[request.mode], request.volume && VOLUME[request.volume]].filter(Boolean).join(' — '),
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
  const valid = cost > 0 && price > 0;

  async function save() {
    setSaving(true);
    setError('');
    try {
      await fetchAPI(`/api/admin/guest-quotes/${request.id}/quote`, {
        method: 'POST',
        body: JSON.stringify({
          carrierCost: cost, price, currency: form.currency,
          ...(form.transitDays !== '' && { transitDays: parseInt(form.transitDays) }),
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
        <div className={a.cardTitle}>{request.quotedRate != null ? 'Re-price' : 'Price'} {request.requestNumber}</div>
        <div className={a.sub}>{request.name}{request.company ? ` (${request.company})` : ''} · {request.origin} → {request.destination} · {MODE[request.mode]}{request.volume ? ` ${VOLUME[request.volume]}` : ''}</div>
        {request.quotedRate != null && <div className={a.info}>Saving replaces the price sent on {day(request.quotedAt)} ({money(request.quotedRate)} {request.quotedCurrency}). The earlier price stays in the activity log.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className={a.field}>Carrier cost *<input className={a.input} type="number" min="0" step="0.01" value={form.carrierCost} onChange={set('carrierCost')} /></label>
          <label className={a.field}>Price to customer *<input className={a.input} type="number" min="0" step="0.01" value={form.price} onChange={set('price')} /></label>
          <label className={a.field}>Currency
            <select className={a.input} value={form.currency} onChange={set('currency')}><option>CAD</option><option>USD</option></select>
          </label>
          <label className={a.field}>Transit (days)<input className={a.input} type="number" min="0" value={form.transitDays} onChange={set('transitDays')} /></label>
          <label className={a.field}>Valid for (business days)<input className={a.input} type="number" min="1" max="60" value={form.validDays} onChange={set('validDays')} /></label>
          <label className={a.field}>Service (customer sees)<input className={a.input} value={form.serviceName} onChange={set('serviceName')} /></label>
        </div>
        <label className={a.field}>Carrier used (internal)<input className={a.input} value={form.carrierName} onChange={set('carrierName')} /></label>
        <label className={a.field}>Message to customer<input className={a.input} value={form.customerNote} onChange={set('customerNote')} maxLength={1000} /></label>
        <label className={a.field}>Internal note<input className={a.input} value={form.staffNote} onChange={set('staffNote')} maxLength={2000} /></label>
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
  const [staffNote, setStaffNote] = useState(request.staffNote || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      await fetchAPI(`/api/admin/guest-quotes/${request.id}/decline`, {
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
        <div className={a.sub}>{request.name} is told IFF can&apos;t offer a rate.{request.quotedRate != null ? ' The price already sent is withdrawn.' : ''}</div>
        <label className={a.field}>Message to customer<input className={a.input} placeholder="e.g. No capacity on this lane this month" value={customerNote} onChange={e => setCustomerNote(e.target.value)} maxLength={1000} /></label>
        <label className={a.field}>Internal note<input className={a.input} value={staffNote} onChange={e => setStaffNote(e.target.value)} maxLength={2000} /></label>
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
