'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import useRole from '@/lib/useRole';
import { CARRIERS } from '@/lib/carriers';
import s from './page.module.css';

const OPEN_BAND_MAX = 999999999;
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'quotes', label: 'Quotes' },
  { id: 'rules', label: 'Pricing rules' },
  { id: 'calibration', label: 'Calibration' },
];
const REASONS = [
  { id: 'discount', label: 'Customer discount' },
  { id: 'competitive', label: 'Competitive match' },
  { id: 'contract', label: 'Contract rate' },
  { id: 'oneoff', label: 'One-off deal' },
  { id: 'correction', label: 'Correction' },
  { id: 'other', label: 'Other' },
];
const ADJUSTER_LABELS = {
  xb: 'Canada / US shipment',
  intl: 'International shipment',
  low_density: 'Density under 6 pcf',
  multi: 'Four or more pieces',
};
const FLOOR_LABELS = {
  Envelope: 'Minimum sell — envelope',
  Package: 'Minimum sell — package',
  Skid: 'Minimum sell — skid',
  LCL: 'Minimum sell — LCL',
  min_gp: 'Minimum gross profit ($)',
  round: 'Round sell up to nearest ($)',
};

const money = n => (n == null ? '—' : Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = n => (n == null ? '—' : `${Number(n).toFixed(1)}%`);
const errMsg = e => e?.error?.message || e?.message || 'Something went wrong';

export default function PricingAdminPage() {
  const router = useRouter();
  const { role, loaded } = useRole();
  const [tab, setTab] = useState('overview');
  const [draft, setDraft] = useState(null); // rules editor draft, shared with calibration "load proposals"

  useEffect(() => {
    if (loaded && role !== 'iff_admin') router.replace('/portal');
  }, [loaded, role, router]);

  if (!loaded || role !== 'iff_admin') {
    return <div className={s.muted}>Loading…</div>;
  }

  return (
    <div>
      <div className={s.tabs}>
        {TABS.map(t => (
          <button key={t.id} className={`${s.tab} ${tab === t.id ? s.tabActive : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'quotes' && <Quotes />}
      {tab === 'rules' && <Rules draft={draft} setDraft={setDraft} />}
      {tab === 'calibration' && (
        <Calibration
          onLoadProposals={(bands, note) => {
            setDraft(prev => ({ ...(prev || {}), bands, note, _fromCalibration: true }));
            setTab('rules');
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────── Overview ───────────────────────── */

function Overview() {
  const [months, setMonths] = useState(12);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    fetchAPI(`/api/admin/pricing/summary?months=${months}`).then(setData).catch(e => setError(errMsg(e)));
  }, [months]);

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>Portal pricing performance</div>
          <div className={s.sub}>Carrier cost vs. what customers were charged, across all quotes and bookings.</div>
        </div>
        <label className={s.inline}>
          Window
          <select className={s.input} value={months} onChange={e => setMonths(Number(e.target.value))}>
            {[1, 3, 6, 12, 24].map(m => <option key={m} value={m}>Last {m} month{m > 1 ? 's' : ''}</option>)}
          </select>
        </label>
      </div>
      {error && <div className={s.error}>{error}</div>}
      {data && (
        <div className={s.tiles}>
          <Tile label="Quotes" value={data.quotes} sub={`${data.rateOptions} carrier options`} />
          <Tile label="Shipments booked" value={data.shipmentsBooked} sub={`${pct(data.conversionPct)} conversion`} />
          {/* CAD and USD bookings are never added together — one pair of tiles per currency. */}
          {Object.entries(data.bookedByCurrency || {}).map(([cur, t]) => (
            <Fragment key={cur}>
              <Tile label={`Booked revenue (${cur})`} value={`$${money(t.sell)} ${cur}`} sub={`${t.shipments} shipments · cost $${money(t.cost)}`} />
              <Tile label={`Booked gross margin (${cur})`} value={`$${money(t.grossMargin)} ${cur}`} sub={`${pct(t.marginPct)} over cost`} />
            </Fragment>
          ))}
          <Tile label="Median markup offered" value={pct(data.medianAchievedMarkupPct)} sub={`average ${pct(data.avgAchievedMarkupPct)}`} />
          <Tile label="Manually adjusted" value={data.adjustedRates} sub="rate options" />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className={s.tile}>
      <div className={s.tileLabel}>{label}</div>
      <div className={s.tileValue}>{value}</div>
      <div className={s.tileSub}>{sub}</div>
    </div>
  );
}

/* ───────────────────────── Quotes ───────────────────────── */

function Quotes() {
  const [filters, setFilters] = useState({ from: '', to: '', carrierId: '', search: '', adjustedOnly: false });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState(null); // { quote, rate }

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, String(v)); });
    setError('');
    fetchAPI(`/api/admin/pricing/quotes?${params}`).then(setData).catch(e => setError(errMsg(e)));
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  const setFilter = (k, v) => { setPage(1); setFilters(f => ({ ...f, [k]: v })); };
  const totalPages = data ? Math.max(1, Math.ceil(data.pagination.total / data.pagination.limit)) : 1;

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>Quotes</div>
          <div className={s.sub}>Carrier cost, the pricing-engine price, and the final price the customer sees.</div>
        </div>
        <button className={s.btnGhost} onClick={load}>↻ Refresh</button>
      </div>

      <div className={s.filters}>
        <input className={s.input} placeholder="Quote # or customer email" value={filters.search} onChange={e => setFilter('search', e.target.value)} />
        <label className={s.inline}>From <input type="date" className={s.input} value={filters.from} onChange={e => setFilter('from', e.target.value)} /></label>
        <label className={s.inline}>To <input type="date" className={s.input} value={filters.to} onChange={e => setFilter('to', e.target.value)} /></label>
        <select className={s.input} value={filters.carrierId} onChange={e => setFilter('carrierId', e.target.value)}>
          <option value="">All carriers</option>
          {CARRIERS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className={s.inline}>
          <input type="checkbox" checked={filters.adjustedOnly} onChange={e => setFilter('adjustedOnly', e.target.checked)} /> Adjusted only
        </label>
      </div>

      {error && <div className={s.error}>{error}</div>}

      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Quote</th>
              <th>Customer</th>
              <th>Carrier / service</th>
              <th className={s.num}>Carrier cost</th>
              <th className={s.num}>Engine price</th>
              <th className={s.num}>Final price</th>
              <th className={s.num}>Engine mk</th>
              <th className={s.num}>Final mk</th>
              <th className={s.num}>Margin</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.data.map(q => q.rates.map((r, i) => (
              <tr key={r.id} className={i === 0 ? s.groupStart : ''}>
                {i === 0 && (
                  <>
                    <td rowSpan={q.rates.length} className={s.quoteCell}>
                      <div className={s.mono}>{q.quoteNumber}</div>
                      <div className={s.small}>{new Date(q.createdAt).toLocaleDateString('en-CA')} · {q.shipmentType.toUpperCase()}</div>
                      <div className={s.small}>{q.lane}</div>
                    </td>
                    <td rowSpan={q.rates.length}>
                      <div>{q.customer?.company || '—'}</div>
                      <div className={s.small}>{q.customer?.email}</div>
                    </td>
                  </>
                )}
                <td>
                  <div>{r.carrierName}</div>
                  <div className={s.small}>{r.serviceName}</div>
                </td>
                <td className={s.num}>
                  {money(r.cost)} <span className={s.small}>{r.currency}</span>
                  {r.accessorialCharges?.length > 0 && (
                    <div className={s.small} title="Accessorial charges from the carrier — included in the cost and passed through without markup">
                      incl. {r.accessorialCharges.map(c => `${c.label} ${money(c.amount)}`).join(' · ')}
                    </div>
                  )}
                  {r.notIncluded && <div className={`${s.small} ${s.negative}`} title={r.notIncluded.message}>not included: {r.notIncluded.labels.join(', ')}</div>}
                </td>
                <td className={s.num}>{money(r.enginePrice)}</td>
                <td className={`${s.num} ${r.adjustment ? s.adjusted : ''}`}>
                  {money(r.finalPrice)}
                  {r.adjustment && (
                    <div className={s.small} title={r.adjustment.note || ''}>
                      {REASONS.find(x => x.id === r.adjustment.reason)?.label || r.adjustment.reason}
                    </div>
                  )}
                  {r.booking?.originalSellRate != null && r.booking.originalSellRate !== r.finalPrice && (
                    <div className={s.small}>booked at {money(r.booking.originalSellRate)}</div>
                  )}
                  {r.booking?.balanceAdjustment ? (
                    <div className={`${s.small} ${r.booking.balanceAdjustment < 0 ? s.negative : s.up}`}>
                      {r.booking.balanceAdjustment < 0 ? `credit owed ${money(-r.booking.balanceAdjustment)}` : `balance due ${money(r.booking.balanceAdjustment)}`}
                    </div>
                  ) : null}
                </td>
                <td className={s.num}>{pct(r.engineMarkupPct)}</td>
                <td className={s.num}>{pct(r.achievedMarkupPct)}</td>
                <td className={`${s.num} ${r.grossMargin < 0 ? s.negative : ''}`}>{money(r.grossMargin)}</td>
                <td>
                  {r.booked
                    ? <span className={`${s.badge} ${s.badgeGreen}`}>Booked {r.booked}</span>
                    : <span className={`${s.badge} ${q.status === 'expired' ? s.badgeGrey : s.badgeBlue}`}>{q.status}</span>}
                </td>
                <td>
                  {(r.booking ? r.booking.status !== 'cancelled' : q.status === 'active') && (
                    <button className={s.linkBtn} onClick={() => setAdjusting({ quote: q, rate: r })}>Adjust</button>
                  )}
                </td>
              </tr>
            )))}
            {data && data.data.length === 0 && (
              <tr><td colSpan={11} className={s.empty}>No quotes match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={s.pager}>
        <button className={s.btnGhost} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
        <span className={s.small}>Page {page} of {totalPages}{data ? ` · ${data.pagination.total} quotes` : ''}</span>
        <button className={s.btnGhost} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
      </div>

      {adjusting && (
        <AdjustModal
          quote={adjusting.quote}
          rate={adjusting.rate}
          onClose={() => setAdjusting(null)}
          onSaved={() => { setAdjusting(null); load(); }}
        />
      )}
    </div>
  );
}

function AdjustModal({ quote, rate, onClose, onSaved }) {
  const [mode, setMode] = useState('discount'); // 'discount' | 'price'
  const [discountPct, setDiscountPct] = useState('');
  const [newRate, setNewRate] = useState(String(rate.finalPrice));
  const [reason, setReason] = useState('discount');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const target = mode === 'discount'
    ? (discountPct === '' ? null : Math.round(rate.enginePrice * (1 - Number(discountPct) / 100) * 100) / 100)
    : (newRate === '' ? null : Number(newRate));
  const margin = target != null ? target - rate.cost : null;
  const markup = target != null && rate.cost ? (target / rate.cost - 1) * 100 : null;
  const belowCost = target != null && target < rate.cost && reason !== 'correction';

  async function save(body) {
    setSaving(true);
    setError('');
    try {
      await fetchAPI(`/api/admin/pricing/quote-rates/${rate.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved();
    } catch (e) {
      setError(errMsg(e));
      setSaving(false);
    }
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.cardTitle}>Adjust price</div>
        <div className={s.sub}>{quote.quoteNumber} · {rate.carrierName} — {rate.serviceName} · {rate.currency}</div>

        {rate.booking && (
          <div className={s.info}>
            Booked as {rate.booking.number}. Changing the price updates the booking and adds an adjustment line to its invoice.
            {rate.booking.paymentStatus === 'paid'
              ? ' The customer already paid, so the difference is recorded as a credit owed (price down) or balance due (price up) for IFF to settle — no automatic refund or charge is made.'
              : ' The invoice is still open, so the new amount is simply what they will be billed.'}
          </div>
        )}
        <div className={s.breakdown}>
          <div><span>Carrier cost</span><b>{money(rate.cost)}</b></div>
          <div><span>Engine price</span><b>{money(rate.enginePrice)}</b></div>
          <div><span>Current final price</span><b>{money(rate.finalPrice)}</b></div>
        </div>

        <div className={s.segmented}>
          <button className={mode === 'discount' ? s.segActive : ''} onClick={() => setMode('discount')}>Discount %</button>
          <button className={mode === 'price' ? s.segActive : ''} onClick={() => setMode('price')}>Set price</button>
        </div>

        {mode === 'discount' ? (
          <label className={s.field}>Discount off engine price (%)
            <input className={s.input} type="number" min="0" max="100" step="0.5" value={discountPct} onChange={e => setDiscountPct(e.target.value)} placeholder="e.g. 10" />
          </label>
        ) : (
          <label className={s.field}>New price ({rate.currency})
            <input className={s.input} type="number" min="0" step="0.01" value={newRate} onChange={e => setNewRate(e.target.value)} />
          </label>
        )}

        <label className={s.field}>Reason
          <select className={s.input} value={reason} onChange={e => setReason(e.target.value)}>
            {REASONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <label className={s.field}>Note (optional)
          <input className={s.input} value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="e.g. matched competitor quote" />
        </label>

        <div className={s.breakdown}>
          <div><span>New price</span><b>{money(target)}</b></div>
          <div><span>Gross margin</span><b className={margin < 0 ? s.negative : ''}>{money(margin)}</b></div>
          <div><span>Markup over cost</span><b>{pct(markup)}</b></div>
        </div>
        {belowCost && <div className={s.error}>Below carrier cost — only allowed with reason “Correction”.</div>}
        {reason === 'contract' || reason === 'oneoff'
          ? <div className={s.small}>Contract and one-off prices are excluded from calibration statistics.</div>
          : null}
        {error && <div className={s.error}>{error}</div>}

        <div className={s.modalActions}>
          {rate.adjustment && rate.finalPrice !== rate.enginePrice && (
            <button className={s.btnGhost} disabled={saving} onClick={() => save({ revert: true })}>Revert to engine price</button>
          )}
          <span style={{ flex: 1 }} />
          <button className={s.btnGhost} onClick={onClose}>Cancel</button>
          <button
            className={s.btnPrimary}
            disabled={saving || target == null || !(target > 0) || belowCost}
            onClick={() => save({ newRate: target, reason, ...(note && { note }) })}
          >
            {saving ? 'Saving…' : 'Save price'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Rules editor ───────────────────────── */

function toDraft(ruleSet) {
  return {
    bands: ruleSet.bands.map(b => ({ max: b.max, mk: b.mk })),
    adjusters: { ...ruleSet.adjusters },
    floors: { ...ruleSet.floors },
    dim_divisor: ruleSet.dim_divisor,
    usdToCadRate: ruleSet.usdToCadRate,
    note: '',
  };
}

function Rules({ draft, setDraft }) {
  const [active, setActive] = useState(null);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [publishing, setPublishing] = useState(false);

  const reload = useCallback(async (keepDraft) => {
    setError('');
    try {
      const [{ ruleSet }, { history: h }] = await Promise.all([
        fetchAPI('/api/pricing-rules/active'),
        fetchAPI('/api/pricing-rules/history'),
      ]);
      setActive(ruleSet);
      setHistory(h);
      setDraft(prev => {
        if (keepDraft && prev?._fromCalibration) {
          // Calibration only proposes band markups — merge them onto the active rules.
          const base = toDraft(ruleSet);
          return { ...base, bands: prev.bands, note: prev.note };
        }
        return keepDraft && prev ? prev : toDraft(ruleSet);
      });
    } catch (e) {
      setError(errMsg(e));
    }
  }, [setDraft]);

  useEffect(() => { reload(true); }, [reload]);

  if (!draft || !active) return <div className={s.card}>{error ? <div className={s.error}>{error}</div> : <div className={s.muted}>Loading rules…</div>}</div>;

  const update = patch => setDraft(d => ({ ...d, ...patch, _fromCalibration: false }));
  const setBand = (i, key, value) => update({ bands: draft.bands.map((b, j) => (j === i ? { ...b, [key]: value } : b)) });
  const removeBand = i => update({ bands: draft.bands.filter((_, j) => j !== i) });
  const addBand = () => {
    const bands = [...draft.bands];
    const last = bands[bands.length - 1];
    const prevMax = bands.length > 1 ? bands[bands.length - 2].max : 0;
    bands.splice(bands.length - 1, 0, { max: Math.round((prevMax || 1000) * 2), mk: last.mk });
    update({ bands });
  };

  async function publish() {
    setError('');
    setMessage('');
    const bands = draft.bands.map((b, i) => ({
      max: i === draft.bands.length - 1 ? OPEN_BAND_MAX : Number(b.max),
      mk: Number(b.mk),
    }));
    for (let i = 1; i < bands.length; i++) {
      if (!(bands[i].max > bands[i - 1].max)) {
        setError(`Band ceilings must increase — row ${i + 1} is not above row ${i}.`);
        return;
      }
    }
    const numObj = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
    setPublishing(true);
    try {
      const { ruleSet } = await fetchAPI('/api/pricing-rules', {
        method: 'POST',
        body: JSON.stringify({
          bands,
          adjusters: numObj(draft.adjusters),
          floors: numObj(draft.floors),
          dim_divisor: Number(draft.dim_divisor),
          usdToCadRate: Number(draft.usdToCadRate),
          ...(draft.note && { note: draft.note }),
        }),
      });
      setMessage(`Published version ${ruleSet.version}. New quotes use it immediately; existing quotes keep the version they were priced with.`);
      setDraft(null);
      await reload(false);
    } catch (e) {
      setError(e?.error?.details ? e.error.details.map(d => `${d.field}: ${d.message}`).join('; ') : errMsg(e));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className={s.rulesLayout}>
      <div className={s.card}>
        <div className={s.cardHead}>
          <div>
            <div className={s.cardTitle}>Current rules</div>
            <div className={s.meta}>
              <span>Version <b>{active.version}</b></span>
              <span>Published <b>{new Date(active.createdAt).toLocaleDateString('en-CA')}</b></span>
              <span>Note <b>{active.note || '—'}</b></span>
            </div>
          </div>
          <div className={s.headActions}>
            <button className={s.btnGhost} onClick={() => { setDraft(null); reload(false); }}>Reload</button>
            <button className={s.btnPrimary} disabled={publishing} onClick={publish}>
              {publishing ? 'Publishing…' : 'Publish changes'}
            </button>
          </div>
        </div>
        {draft._fromCalibration && <div className={s.info}>Band markups loaded from the calibration report — review, then publish.</div>}
        {message && <div className={s.success}>{message}</div>}
        {error && <div className={s.error}>{error}</div>}

        <div className={s.rulesGrid}>
          <div>
            <div className={s.sectionTitle}>Margin bands — markup added to carrier cost (CAD)</div>
            <table className={s.table}>
              <thead><tr><th>From</th><th>Band ceiling</th><th className={s.num}>Markup %</th><th /></tr></thead>
              <tbody>
                {draft.bands.map((b, i) => {
                  const last = i === draft.bands.length - 1;
                  const from = i === 0 ? 0 : draft.bands[i - 1].max;
                  const changedMk = active.bands[i] && Number(active.bands[i].mk) !== Number(b.mk);
                  return (
                    <tr key={i}>
                      <td className={s.small}>${from} –</td>
                      <td>
                        {last
                          ? <span className={s.small}>and up</span>
                          : <input className={`${s.input} ${s.inputSm}`} type="number" min="1" value={b.max} onChange={e => setBand(i, 'max', e.target.value)} />}
                      </td>
                      <td className={s.num}>
                        <input className={`${s.input} ${s.inputSm} ${changedMk ? s.changed : ''}`} type="number" step="0.5" value={b.mk} onChange={e => setBand(i, 'mk', e.target.value)} />
                      </td>
                      <td>{!last && draft.bands.length > 1 && <button className={s.linkBtn} onClick={() => removeBand(i)}>×</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className={s.btnGhost} onClick={addBand}>+ Add band</button>
          </div>

          <div>
            <div className={s.sectionTitle}>Adjusters — extra percentage points on the band</div>
            {Object.keys(ADJUSTER_LABELS).map(k => (
              <label key={k} className={s.row}>
                <span>{ADJUSTER_LABELS[k]}</span>
                <input className={`${s.input} ${s.inputSm}`} type="number" step="0.5" value={draft.adjusters[k]} onChange={e => update({ adjusters: { ...draft.adjusters, [k]: e.target.value } })} />
              </label>
            ))}

            <div className={s.sectionTitle}>Floors — the price never falls below these</div>
            {Object.keys(FLOOR_LABELS).map(k => (
              <label key={k} className={s.row}>
                <span>{FLOOR_LABELS[k]}</span>
                <input className={`${s.input} ${s.inputSm}`} type="number" step="1" min={k === 'round' ? 1 : 0} value={draft.floors[k]} onChange={e => update({ floors: { ...draft.floors, [k]: e.target.value } })} />
              </label>
            ))}

            <div className={s.sectionTitle}>Other</div>
            <label className={s.row}>
              <span>USD → CAD rate</span>
              <input className={`${s.input} ${s.inputSm}`} type="number" step="0.01" value={draft.usdToCadRate} onChange={e => update({ usdToCadRate: e.target.value })} />
            </label>
            <label className={s.row}>
              <span>Dim divisor (in³/lb)</span>
              <input className={`${s.input} ${s.inputSm}`} type="number" step="1" value={draft.dim_divisor} onChange={e => update({ dim_divisor: e.target.value })} />
            </label>
            <label className={s.field}>Publish note
              <input className={s.input} value={draft.note || ''} onChange={e => update({ note: e.target.value })} placeholder="e.g. raised small-parcel band after Q3 review" />
            </label>
          </div>
        </div>

        {history.length > 0 && (
          <>
            <div className={s.sectionTitle}>Version history</div>
            <table className={s.table}>
              <thead><tr><th>Version</th><th>Published</th><th>By</th><th>Bands (markup %)</th><th>Note</th></tr></thead>
              <tbody>
                {history.map(h => (
                  <tr key={h._id}>
                    <td>{h.version}{h.active && <span className={`${s.badge} ${s.badgeGreen}`}>active</span>}</td>
                    <td>{new Date(h.createdAt).toLocaleDateString('en-CA')}</td>
                    <td className={s.small}>{h.createdBy?.email || 'seed'}</td>
                    <td className={s.small}>{h.bands.map(b => b.mk).join(' / ')}</td>
                    <td className={s.small}>{h.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <Calculator draft={draft} />
    </div>
  );
}

const MODES = {
  Envelope: 'courier',
  Package: 'courier',
  Skid: 'ltl',
  LCL: 'lcl',
};

// "See the effect before publishing": prices a sample shipment against the unpublished draft.
function Calculator({ draft }) {
  const [form, setForm] = useState({ cost: '600', currency: 'CAD', scope: 'dom', packaging: 'Skid', qty: '1', l: '48', w: '40', h: '40', wt: '500' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const numObj = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));
  const ruleSet = useMemo(() => ({
    bands: draft.bands.map((b, i) => ({ max: i === draft.bands.length - 1 ? OPEN_BAND_MAX : Number(b.max), mk: Number(b.mk) })),
    adjusters: numObj(draft.adjusters),
    floors: numObj(draft.floors),
    dim_divisor: Number(draft.dim_divisor),
    usdToCadRate: Number(draft.usdToCadRate),
  }), [draft]);

  async function run() {
    setError('');
    try {
      const { result: r } = await fetchAPI('/api/admin/pricing/preview', {
        method: 'POST',
        body: JSON.stringify({
          ruleSet,
          shipment: {
            cost: Number(form.cost),
            currency: form.currency,
            scope: form.scope,
            mode: MODES[form.packaging],
            packaging: form.packaging,
            lines: [{ qty: Number(form.qty) || 1, l: Number(form.l) || 0, w: Number(form.w) || 0, h: Number(form.h) || 0, wt: Number(form.wt) || 0 }],
          },
        }),
      });
      setResult(r);
    } catch (e) {
      setResult(null);
      setError(e?.error?.details ? e.error.details.map(d => `${d.field}: ${d.message}`).join('; ') : errMsg(e));
    }
  }

  return (
    <div className={`${s.card} ${s.calc}`}>
      <div className={s.cardTitle}>Test the draft rules</div>
      <div className={s.sub}>Prices a sample shipment against the rules on the left — nothing is saved.</div>
      <div className={s.calcGrid}>
        <label className={s.field}>Carrier cost<input className={s.input} type="number" value={form.cost} onChange={e => set('cost', e.target.value)} /></label>
        <label className={s.field}>Currency
          <select className={s.input} value={form.currency} onChange={e => set('currency', e.target.value)}><option>CAD</option><option>USD</option></select>
        </label>
        <label className={s.field}>Scope
          <select className={s.input} value={form.scope} onChange={e => set('scope', e.target.value)}>
            <option value="dom">Domestic</option><option value="xb">Canada / US</option><option value="intl">International</option>
          </select>
        </label>
        <label className={s.field}>Packaging
          <select className={s.input} value={form.packaging} onChange={e => set('packaging', e.target.value)}>
            {Object.keys(MODES).map(p => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label className={s.field}>Qty<input className={s.input} type="number" value={form.qty} onChange={e => set('qty', e.target.value)} /></label>
        <label className={s.field}>Wt / pc (lb)<input className={s.input} type="number" value={form.wt} onChange={e => set('wt', e.target.value)} /></label>
        <label className={s.field}>L (in)<input className={s.input} type="number" value={form.l} onChange={e => set('l', e.target.value)} /></label>
        <label className={s.field}>W (in)<input className={s.input} type="number" value={form.w} onChange={e => set('w', e.target.value)} /></label>
        <label className={s.field}>H (in)<input className={s.input} type="number" value={form.h} onChange={e => set('h', e.target.value)} /></label>
      </div>
      <button className={s.btnPrimary} onClick={run}>Get price</button>
      {error && <div className={s.error}>{error}</div>}
      {result && (
        <div className={s.result}>
          <div className={s.tileLabel}>Recommended sell</div>
          <div className={s.bigPrice}>${money(result.sell)} <span className={s.small}>{result.currency}</span></div>
          <div className={s.small}>{pct(result.markupPct)} markup · {money(result.grossMargin)} gross</div>
          <div className={s.breakdown}>
            <div><span>Carrier cost (CAD)</span><b>{money(result.costCad)}</b></div>
            <div><span>Sell (CAD)</span><b>{money(result.sellCad)}</b></div>
            <div><span>Chargeable weight</span><b>{result.chargeableWt ?? '—'} {form.packaging === 'LCL' ? 'rt' : 'lb'}</b></div>
            <div><span>Density</span><b>{result.densityPcf != null ? `${result.densityPcf} pcf` : '—'}</b></div>
            <div><span>Est. class</span><b>{result.estClass ?? '—'}</b></div>
          </div>
          {result.flags?.length > 0 && <ul className={s.flags}>{result.flags.map(f => <li key={f}>{f}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Calibration ───────────────────────── */

function Calibration({ onLoadProposals }) {
  const [months, setMonths] = useState(12);
  const [minN, setMinN] = useState(30);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await fetchAPI(`/api/admin/pricing/calibration?months=${months}&minN=${minN}`));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [months, minN]);

  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hasProposals = report?.bands.some(b => b.proposedMk != null && b.proposedMk !== b.currentMk);

  function loadIntoRules() {
    const bands = report.bands.map(b => ({ max: b.max, mk: b.proposedMk ?? b.currentMk }));
    const moved = report.bands.filter(b => b.proposedMk != null && b.proposedMk !== b.currentMk)
      .map(b => `${b.band} ${b.currentMk}→${b.proposedMk}`).join(', ');
    onLoadProposals(bands, `Calibration (${months}mo, min ${minN}): ${moved}`);
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <div>
          <div className={s.cardTitle}>Calibration</div>
          <div className={s.sub}>
            Distribution of the markup customers were actually offered (after manual adjustments), per cost band.
            Contract and one-off prices are excluded. Proposals move toward the median by at most ±{report?.cap ?? 10} points and are never applied automatically.
          </div>
        </div>
        <div className={s.headActions}>
          <label className={s.inline}>Months <input className={`${s.input} ${s.inputSm}`} type="number" min="1" max="60" value={months} onChange={e => setMonths(Number(e.target.value))} /></label>
          <label className={s.inline}>Min N <input className={`${s.input} ${s.inputSm}`} type="number" min="1" value={minN} onChange={e => setMinN(Number(e.target.value))} /></label>
          <button className={s.btnGhost} onClick={run} disabled={loading}>{loading ? 'Running…' : 'Run report'}</button>
        </div>
      </div>
      {error && <div className={s.error}>{error}</div>}

      {report && (
        <>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Band</th>
                  <th className={s.num}>Current</th>
                  <th className={s.num}>Quotes</th>
                  <th className={s.num}>Booked</th>
                  <th className={s.num}>Adjusted</th>
                  <th className={s.num}>P25</th>
                  <th className={s.num}>Median</th>
                  <th className={s.num}>P75</th>
                  <th className={s.num}>Spread</th>
                  <th className={s.num}>Customers</th>
                  <th className={s.num}>Proposed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {report.bands.map(b => {
                  const delta = b.proposedMk != null ? b.proposedMk - b.currentMk : null;
                  return (
                    <tr key={b.band}>
                      <td className={s.mono}>{b.band}</td>
                      <td className={s.num}>{b.currentMk}%</td>
                      <td className={s.num}>{b.quotes}</td>
                      <td className={s.num}>{b.booked}</td>
                      <td className={s.num}>{b.adjusted}</td>
                      <td className={s.num}>{pct(b.p25)}</td>
                      <td className={s.num}><b>{pct(b.median)}</b></td>
                      <td className={s.num}>{pct(b.p75)}</td>
                      <td className={`${s.num} ${b.spread > 60 ? s.negative : ''}`}>{b.spread ?? '—'}</td>
                      <td className={s.num}>{b.customers}</td>
                      <td className={s.num}>
                        {b.proposedMk == null ? '—' : (
                          <>
                            {b.proposedMk}%{' '}
                            {delta !== 0 && <span className={delta > 0 ? s.up : s.down}>{delta > 0 ? '+' : ''}{delta}</span>}
                          </>
                        )}
                      </td>
                      <td className={s.small}>{b.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={s.pager}>
            <span className={s.small}>Rules version {report.rulesVersion} · last {report.months} months · min {report.minN} quotes per band</span>
            <button className={s.btnPrimary} disabled={!hasProposals} onClick={loadIntoRules}>Load proposals into rules editor</button>
          </div>
        </>
      )}
    </div>
  );
}
