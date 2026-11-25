'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import useRole from '@/lib/useRole';
import a from '../pricing/page.module.css';
import s from '../../spot-rates/page.module.css';

// IFF staff: price corrections after a carrier re-weighs / re-measures / re-classes a shipment.
// Staff enter the carrier's corrected cost; the pricing engine (same rules version as the
// original quote) works out what the customer owes or gets back.
const STAFF_ROLES = ['iff_staff', 'iff_admin'];
const STATUS = {
  draft: { label: 'Draft', cls: a.badgeGrey },
  sent: { label: 'Awaiting payment', cls: s.badgeAmber },
  disputed: { label: 'Disputed', cls: s.badgeRed },
  paid: { label: 'Paid', cls: a.badgeGreen },
  waived: { label: 'Waived', cls: a.badgeGrey },
  absorbed: { label: 'Absorbed by IFF', cls: a.badgeGrey },
  credited: { label: 'Credited', cls: a.badgeBlue },
  refunded: { label: 'Refunded', cls: a.badgeBlue },
  cancelled: { label: 'Cancelled', cls: a.badgeGrey },
};
const FILTERS = [{ id: 'open', label: 'Open' }, { id: 'disputed', label: 'Disputed' }, { id: 'paid', label: 'Paid' }, { id: 'all', label: 'All' }];
const REASONS = [
  { value: 'weight', label: 'Weight (re-weigh)' },
  { value: 'dimensions', label: 'Dimensions (re-measure)' },
  { value: 'freight_class', label: 'Freight class (re-class)' },
  { value: 'accessorial', label: 'Extra service found (e.g. liftgate, residential)' },
  { value: 'other', label: 'Other' },
];
const OUTCOME = {
  charge: 'Customer pays the difference',
  absorbed: 'Within the threshold — IFF absorbs it',
  credit: 'Carrier charged less — customer gets the difference back',
};
const cur = c => (c === 'USD' ? 'US$' : 'C$');
const money = (n, c = 'CAD') => (n == null ? '—' : `${cur(c)}${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = d => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const errMsg = e => e?.error?.details?.[0]?.message || e?.error?.message || e?.message || 'Something went wrong';
const num = v => (v === '' || v == null ? undefined : Number(v));

const emptyForm = () => ({ booking: '', reason: 'weight', newCost: '', weight: '', pieces: '', length: '', width: '', height: '', freightClass: '', carrierReference: '', evidenceNote: '', staffNote: '' });

export default function AdjustmentsPage() {
  const router = useRouter();
  const { role, loaded } = useRole();
  const allowed = STAFF_ROLES.includes(role);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(null); // adjustment to send (choose credit/refund for undercharges)

  useEffect(() => { if (loaded && !allowed) router.replace('/portal'); }, [loaded, allowed, router]);

  const load = useCallback(() => {
    if (!allowed) return;
    setError('');
    const params = new URLSearchParams({ status: filter, ...(search && { search }) });
    fetchAPI(`/api/admin/adjustments?${params}`).then(setData).catch(e => setError(errMsg(e)));
  }, [allowed, filter, search]);
  useEffect(() => { load(); }, [load]);

  const set = field => e => { setForm(f => ({ ...f, [field]: e.target.value })); setPreview(null); };

  function correctionBody() {
    const measured = Object.fromEntries(Object.entries({
      weight: num(form.weight), pieces: num(form.pieces), length: num(form.length), width: num(form.width), height: num(form.height),
      freightClass: form.freightClass.trim() || undefined,
    }).filter(([, v]) => v !== undefined));
    return { booking: form.booking.trim(), newCost: num(form.newCost), ...(Object.keys(measured).length && { measured }) };
  }

  async function runPreview() {
    setError('');
    if (!form.booking.trim() || !(num(form.newCost) > 0)) { setError('Enter the booking, quote or tracking number and the carrier\'s corrected cost.'); return; }
    setBusy(true);
    try { setPreview(await fetchAPI('/api/admin/adjustments/preview', { method: 'POST', body: JSON.stringify(correctionBody()) })); }
    catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  async function create() {
    setBusy(true);
    setError('');
    try {
      await fetchAPI('/api/admin/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          ...correctionBody(),
          reason: form.reason,
          ...(form.carrierReference.trim() && { carrierReference: form.carrierReference.trim() }),
          ...(form.evidenceNote.trim() && { evidenceNote: form.evidenceNote.trim() }),
          ...(form.staffNote.trim() && { staffNote: form.staffNote.trim() }),
        }),
      });
      setCreating(false); setForm(emptyForm()); setPreview(null); setFilter('open');
      load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  async function act(r, path, body = {}, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError('');
    try {
      await fetchAPI(`/api/admin/adjustments/${r.id}/${path}`, { method: 'POST', body: JSON.stringify(body) });
      setSending(null);
      load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  if (!loaded || !allowed) return <div className={a.muted}>Loading…</div>;
  const settings = data?.settings;

  return (
    <div className={a.card}>
      <div className={a.cardHead}>
        <div>
          <div className={a.cardTitle}>Price adjustments</div>
          <div className={a.sub}>
            When a carrier re-weighs, re-measures or re-classes a shipment, enter its corrected cost here. The new price uses the same pricing rules as the original quote.
            {settings && <> Differences up to {money(settings.threshold)} are absorbed; fee {money(settings.adminFee)} per charged adjustment; {settings.paymentDays} days to pay before the account goes on hold.</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={a.btnPrimary} onClick={() => { setCreating(true); setPreview(null); setError(''); }}>+ New adjustment</button>
          <button className={a.btnGhost} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <div className={a.filters}>
        <div className={a.segmented}>
          {FILTERS.map(f => <button key={f.id} className={filter === f.id ? a.segActive : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
        </div>
        <input className={a.input} placeholder="Adjustment, booking or quote #" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {error && <div className={a.error}>{error}</div>}

      <div className={a.tableWrap}>
        <table className={a.table}>
          <thead>
            <tr><th>Adjustment</th><th>Booking</th><th>Reason</th><th className={a.num}>Quoted → new price</th><th className={a.num}>Customer owes / gets</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {data?.data.map(r => {
              const st = STATUS[r.status] || STATUS.draft;
              return (
                <Fragment key={r.id}>
                  <tr className={a.groupStart}>
                    <td>
                      <button className={a.linkBtn} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? '▾' : '▸'} <span className={a.mono}>{r.adjustmentNumber}</span></button>
                      <div className={a.small}>{day(r.createdAt)}</div>
                    </td>
                    <td>
                      <div className={a.mono}>{r.booking?.bookingNumber}</div>
                      <div className={a.small}>{r.company?.name}{r.company?.paymentTerms === 'monthly' ? ', monthly' : ''}, {r.booking?.carrierName}</div>
                    </td>
                    <td>{REASONS.find(x => x.value === r.reason)?.label.split(' (')[0] || r.reason}</td>
                    <td className={a.num}>{money(r.originalPrice, r.currency)} → {money(r.newPrice, r.currency)}</td>
                    <td className={a.num}>
                      {r.amountDue > 0 && <b>{money(r.amountDue, r.currency)}</b>}
                      {r.creditAmount > 0 && <b>− {money(r.creditAmount, r.currency)}</b>}
                      {!(r.amountDue > 0) && !(r.creditAmount > 0) && '—'}
                      {r.adminFee > 0 && <div className={a.small}>incl. {money(r.adminFee, r.currency)} fee</div>}
                    </td>
                    <td>
                      <span className={`${a.badge} ${st.cls}`}>{st.label}</span>
                      {r.overdue && <span className={`${a.badge} ${s.badgeRed}`}>overdue</span>}
                      {r.status === 'sent' && <div className={a.small}>due {day(r.dueDate)}</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'draft' && <>
                        <button className={a.linkBtn} disabled={busy} onClick={() => (r.outcome === 'credit' ? setSending(r) : act(r, 'send', {}, r.outcome === 'charge' ? `Send ${r.adjustmentNumber} to the customer for ${money(r.amountDue, r.currency)}?` : null))}>Send</button>
                        {' '}<button className={a.linkBtn} disabled={busy} onClick={() => act(r, 'cancel', {}, `Cancel draft ${r.adjustmentNumber}?`)}>Cancel</button>
                      </>}
                      {r.status === 'sent' && <>
                        <button className={a.linkBtn} disabled={busy} onClick={() => act(r, 'mark-paid', {}, `Mark ${r.adjustmentNumber} as paid (cheque / transfer received)?`)}>Mark paid</button>
                        {' '}<button className={a.linkBtn} disabled={busy} onClick={() => act(r, 'waive', {}, `Waive ${r.adjustmentNumber}? The customer won't pay it.`)}>Waive</button>
                      </>}
                      {r.status === 'disputed' && <>
                        <button className={a.linkBtn} disabled={busy} onClick={() => act(r, 'resolve', { decision: 'uphold' }, `Uphold ${r.adjustmentNumber}? The customer gets ${data?.settings?.paymentDays || 14} new days to pay.`)}>Uphold</button>
                        {' '}<button className={a.linkBtn} disabled={busy} onClick={() => act(r, 'resolve', { decision: 'waive' }, `Waive ${r.adjustmentNumber}?`)}>Waive</button>
                      </>}
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={7}>
                        <div className={a.breakdown}>
                          <div><span>Customer entered</span><b>{r.entered?.weight ?? '—'} lb{r.entered?.length ? `, ${r.entered.length}×${r.entered.width}×${r.entered.height} in` : ''}{r.entered?.freightClass ? `, class ${r.entered.freightClass}` : ''}</b></div>
                          <div><span>Carrier measured</span><b>{r.measured?.weight ? `${r.measured.weight} lb` : '—'}{r.measured?.length ? `, ${r.measured.length}×${r.measured.width}×${r.measured.height} in` : ''}{r.measured?.freightClass ? `, class ${r.measured.freightClass}` : ''}</b></div>
                          <div><span>Carrier cost</span><b>{money(r.originalCost, r.currency)} → {money(r.newCost, r.currency)}</b></div>
                          <div><span>Price (rules v{r.rulesVersion})</span><b>{money(r.originalPrice, r.currency)} → {money(r.newPrice, r.currency)} (difference {money(r.difference, r.currency)})</b></div>
                          {r.carrierReference && <div><span>Carrier reference</span><b>{r.carrierReference}</b></div>}
                          {r.evidenceNote && <div><span>Carrier evidence</span><b style={{ whiteSpace: 'pre-line' }}>{r.evidenceNote}</b></div>}
                          {r.disputeReason && <div><span>Customer dispute</span><b style={{ whiteSpace: 'pre-line' }}>{r.disputeReason}</b></div>}
                          {r.resolutionNote && <div><span>Resolution</span><b>{r.resolutionNote}</b></div>}
                          {r.staffNote && <div><span>Internal note</span><b>{r.staffNote}</b></div>}
                          {r.paidAt && <div><span>Paid</span><b>{day(r.paidAt)}{r.paidWithCredit > 0 ? ` (${money(r.paidWithCredit, r.currency)} from store credit)` : ''}</b></div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {data && data.data.length === 0 && <tr><td colSpan={7} className={a.empty}>No adjustments here.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* New adjustment */}
      {creating && (
        <div className={a.overlay} onClick={() => !busy && setCreating(false)}>
          <div className={a.modal} onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className={a.cardTitle}>New price adjustment</div>
            <div className={a.row}>
              <label className={a.field}>Booking, quote or tracking # *<input className={a.input} placeholder="BK-2026-0012, Q-2026-0254 or tracking #" value={form.booking} onChange={set('booking')} /></label>
              <label className={a.field}>Reason *
                <select className={a.input} value={form.reason} onChange={set('reason')}>{REASONS.map(x => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
              </label>
            </div>
            <div className={a.row}>
              <label className={a.field}>Carrier&apos;s corrected cost *<input className={a.input} type="number" min="0" step="0.01" placeholder="Total the carrier now charges" value={form.newCost} onChange={set('newCost')} /></label>
              <label className={a.field}>Carrier reference<input className={a.input} placeholder="Invoice / reweigh certificate #" value={form.carrierReference} onChange={set('carrierReference')} /></label>
            </div>
            <div className={a.sub} style={{ margin: '6px 0' }}>What the carrier measured (optional — used for the price and shown to the customer):</div>
            <div className={a.row}>
              <label className={a.field}>Total weight (lb)<input className={a.input} type="number" min="0" value={form.weight} onChange={set('weight')} /></label>
              <label className={a.field}>Pieces<input className={a.input} type="number" min="1" value={form.pieces} onChange={set('pieces')} /></label>
              <label className={a.field}>Freight class<input className={a.input} placeholder="e.g. 85" value={form.freightClass} onChange={set('freightClass')} /></label>
            </div>
            <div className={a.row}>
              <label className={a.field}>Length (in)<input className={a.input} type="number" min="0" value={form.length} onChange={set('length')} /></label>
              <label className={a.field}>Width (in)<input className={a.input} type="number" min="0" value={form.width} onChange={set('width')} /></label>
              <label className={a.field}>Height (in)<input className={a.input} type="number" min="0" value={form.height} onChange={set('height')} /></label>
            </div>
            <label className={a.field}>What the carrier reported (shown to the customer)<textarea className={a.input} rows={2} value={form.evidenceNote} onChange={set('evidenceNote')} /></label>
            <label className={a.field}>Internal note<input className={a.input} value={form.staffNote} onChange={set('staffNote')} /></label>

            {preview && (
              <div className={a.breakdown} style={{ marginTop: 10 }}>
                <div><span>Booking</span><b>{preview.bookingNumber}, {preview.carrierName}</b></div>
                <div><span>Carrier cost</span><b>{money(preview.originalCost, preview.currency)} → {money(preview.newCost, preview.currency)}</b></div>
                <div><span>Price (rules v{preview.rulesVersion})</span><b>{money(preview.originalPrice, preview.currency)} → {money(preview.newPrice, preview.currency)}</b></div>
                <div><span>Difference</span><b>{money(preview.difference, preview.currency)}</b></div>
                {preview.adminFee > 0 && <div><span>Admin fee</span><b>{money(preview.adminFee, preview.currency)}</b></div>}
                <div><span>Result</span><b>{OUTCOME[preview.outcome]}{preview.amountDue > 0 ? `: ${money(preview.amountDue, preview.currency)}` : preview.creditAmount > 0 ? `: ${money(preview.creditAmount, preview.currency)}` : ''}</b></div>
              </div>
            )}
            {error && <div className={a.error}>{error}</div>}
            <div className={a.modalActions}>
              <button className={a.btnGhost} disabled={busy} onClick={() => setCreating(false)}>Close</button>
              <button className={a.btnGhost} disabled={busy} onClick={runPreview}>Calculate</button>
              <button className={a.btnPrimary} disabled={busy || !preview} onClick={create}>Save as draft</button>
            </div>
          </div>
        </div>
      )}

      {/* Send an undercharge: store credit (default) or refund to the card */}
      {sending && (
        <div className={a.overlay} onClick={() => !busy && setSending(null)}>
          <div className={a.modal} onClick={e => e.stopPropagation()}>
            <div className={a.cardTitle}>Return {money(sending.creditAmount, sending.currency)} to the customer</div>
            <p className={a.sub}>The carrier charged less than quoted. Store credit is used automatically on the customer&apos;s next booking; a refund goes back to the card they paid with.</p>
            {error && <div className={a.error}>{error}</div>}
            <div className={a.modalActions}>
              <button className={a.btnGhost} disabled={busy} onClick={() => setSending(null)}>Cancel</button>
              <button className={a.btnGhost} disabled={busy} onClick={() => act(sending, 'send', { undercharge: 'refund' })}>Refund to card</button>
              <button className={a.btnPrimary} disabled={busy} onClick={() => act(sending, 'send', { undercharge: 'credit' })}>Give store credit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
