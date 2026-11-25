'use client';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import useRole from '@/lib/useRole';
import a from '../pricing/page.module.css';
import s from '../../spot-rates/page.module.css';

// IFF staff: customer accounts. Admins set payment terms (card / monthly) and the credit limit;
// staff see monthly statements and record payments received.
const STAFF_ROLES = ['iff_staff', 'iff_admin'];
const STATEMENT_STATUS = {
  open: { label: 'Open', cls: s.badgeAmber },
  partially_paid: { label: 'Partly paid', cls: a.badgeBlue },
  paid: { label: 'Paid', cls: a.badgeGreen },
  void: { label: 'Void', cls: a.badgeGrey },
};
const money = n => (n == null ? '—' : `C$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = d => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const errMsg = e => e?.error?.details?.[0]?.message || e?.error?.message || e?.message || 'Something went wrong';
const previousPeriod = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default function AccountsPage() {
  const router = useRouter();
  const { role, loaded } = useRole();
  const allowed = STAFF_ROLES.includes(role);
  const isAdmin = role === 'iff_admin';
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('monthly');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(null);
  const [statements, setStatements] = useState({}); // by company id
  const [editing, setEditing] = useState(null); // { id, name, paymentTerms, creditLimit, statementTermsDays }
  const [paying, setPaying] = useState(null); // { statement, companyId, amount, method, reference }
  const [period, setPeriod] = useState(previousPeriod());
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (loaded && !allowed) router.replace('/portal'); }, [loaded, allowed, router]);

  const load = useCallback(() => {
    if (!allowed) return;
    setError('');
    fetchAPI('/api/admin/accounts').then(d => setRows(d.data)).catch(e => setError(errMsg(e)));
  }, [allowed]);
  useEffect(() => { load(); }, [load]);

  const loadStatements = useCallback((companyId) => {
    fetchAPI(`/api/admin/accounts/${companyId}/statements`)
      .then(d => setStatements(prev => ({ ...prev, [companyId]: d.data })))
      .catch(e => setError(errMsg(e)));
  }, []);

  function toggle(id) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    loadStatements(id);
  }

  async function saveTerms() {
    setBusy(true); setError('');
    try {
      await fetchAPI(`/api/admin/accounts/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentTerms: editing.paymentTerms, creditLimit: Number(editing.creditLimit) || 0, statementTermsDays: Number(editing.statementTermsDays) || 0 }),
      });
      setEditing(null); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  async function recordPayment() {
    setBusy(true); setError('');
    try {
      await fetchAPI(`/api/admin/statements/${paying.statement.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: Number(paying.amount), method: paying.method, ...(paying.reference.trim() && { reference: paying.reference.trim() }) }),
      });
      loadStatements(paying.companyId); setPaying(null); load();
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  // One company, everything unpaid up to today (the month-end statement still runs later).
  async function createNow(r) {
    if (!window.confirm(`Create a statement now for ${r.name}? It bills every unpaid invoice up to today, due in ${r.statementTermsDays} days.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const st = await fetchAPI(`/api/admin/accounts/${r.id}/statements`, { method: 'POST' });
      setNotice(`Created ${st.statementNumber} for ${r.name}: C$${Number(st.amountDue).toFixed(2)} due ${day(st.dueDate)}.`);
      load(); setOpen(r.id); loadStatements(r.id);
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  async function generate() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await fetchAPI('/api/admin/statements/generate', { method: 'POST', body: JSON.stringify({ period }) });
      setNotice(r.created.length ? `Issued ${r.created.length} statement(s) for ${r.period}: ${r.created.join(', ')}` : `No new statements for ${r.period} (already issued, or nothing unpaid).`);
      load(); if (open) loadStatements(open);
    } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  if (!loaded || !allowed) return <div className={a.muted}>Loading…</div>;

  const shown = (rows || []).filter(r => (filter === 'all' || r.paymentTerms === filter) && (!search || r.name.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className={a.card}>
      <div className={a.cardHead}>
        <div>
          <div className={a.cardTitle}>Customer accounts</div>
          <div className={a.sub}>Monthly-terms customers book against a credit limit; each booking is invoiced and last month&apos;s invoices go on one statement on the 1st (issued automatically).</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className={a.input} style={{ width: 110 }} value={period} onChange={e => setPeriod(e.target.value)} placeholder="2026-10" aria-label="Statement period" />
          <button className={a.btnGhost} disabled={busy} onClick={generate}>Generate statements</button>
          <button className={a.btnGhost} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      <div className={a.filters}>
        <div className={a.segmented}>
          {[{ id: 'monthly', label: 'Monthly terms' }, { id: 'card', label: 'Card' }, { id: 'all', label: 'All' }].map(f => (
            <button key={f.id} className={filter === f.id ? a.segActive : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        <input className={a.input} placeholder="Company name" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {error && <div className={a.error}>{error}</div>}
      {notice && <div className={a.success}>{notice}</div>}

      <div className={a.tableWrap}>
        <table className={a.table}>
          <thead>
            <tr><th>Company</th><th>Terms</th><th className={a.num}>Credit limit</th><th className={a.num}>Used</th><th className={a.num}>Available</th><th className={a.num}>Statement balance</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <Fragment key={r.id}>
                <tr className={a.groupStart}>
                  <td>
                    <button className={a.linkBtn} onClick={() => toggle(r.id)}>{open === r.id ? '▾' : '▸'} {r.name}</button>
                    <div className={a.small}>{[r.city, r.country].filter(Boolean).join(', ')}</div>
                  </td>
                  <td>{r.paymentTerms === 'monthly' ? `Monthly, Net ${r.statementTermsDays}` : 'Card'}</td>
                  <td className={a.num}>{r.paymentTerms === 'monthly' ? money(r.creditLimit) : '—'}</td>
                  <td className={a.num}>{r.paymentTerms === 'monthly' ? money(r.used) : '—'}</td>
                  <td className={a.num}>{r.paymentTerms === 'monthly' ? <span className={r.available < 0 ? a.negative : ''}>{money(r.available)}</span> : '—'}</td>
                  <td className={a.num}>{r.openStatementBalance > 0 ? money(r.openStatementBalance) : '—'}</td>
                  <td>
                    {r.accountHold?.active
                      ? <span className={`${a.badge} ${s.badgeRed}`} title={r.accountHold.reason}>On hold</span>
                      : <span className={`${a.badge} ${a.badgeGreen}`}>OK</span>}
                    {(r.credit?.CAD > 0 || r.credit?.USD > 0) && <div className={a.small}>store credit {r.credit.CAD > 0 ? money(r.credit.CAD) : ''}{r.credit.USD > 0 ? ` US$${r.credit.USD.toFixed(2)}` : ''}</div>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                      {isAdmin && <button className={a.linkBtn} onClick={() => setEditing({ id: r.id, name: r.name, paymentTerms: r.paymentTerms, creditLimit: r.creditLimit || '', statementTermsDays: r.statementTermsDays || 30 })}>Edit terms</button>}
                      {r.paymentTerms === 'monthly' && r.used > 0 && <button className={a.linkBtn} disabled={busy} onClick={() => createNow(r)}>Create statement now</button>}
                    </div>
                  </td>
                </tr>
                {open === r.id && (
                  <tr>
                    <td colSpan={8}>
                      {r.accountHold?.active && <div className={a.error}>On hold: {r.accountHold.reason}</div>}
                      {!statements[r.id] && <div className={a.muted}>Loading statements…</div>}
                      {statements[r.id]?.length === 0 && <div className={a.muted}>No statements yet.</div>}
                      {statements[r.id]?.length > 0 && (
                        <table className={a.table}>
                          <thead><tr><th>Statement</th><th>Period</th><th className={a.num}>Total</th><th className={a.num}>Store credit</th><th className={a.num}>Paid</th><th className={a.num}>Balance</th><th>Due</th><th>Status</th><th></th></tr></thead>
                          <tbody>
                            {statements[r.id].map(st => {
                              const stStatus = STATEMENT_STATUS[st.status] || STATEMENT_STATUS.open;
                              return (
                                <tr key={st.id}>
                                  <td className={a.mono}>{st.statementNumber}<div className={a.small}>{st.lines.length} invoice(s)</div></td>
                                  <td>{st.period}</td>
                                  <td className={a.num}>{money(st.totalCad)}{st.totals?.USD > 0 && <div className={a.small}>incl. US${st.totals.USD.toFixed(2)} @ {st.fxRate}</div>}</td>
                                  <td className={a.num}>{st.creditApplied > 0 ? `− ${money(st.creditApplied)}` : '—'}</td>
                                  <td className={a.num}>{money(st.paidAmount)}</td>
                                  <td className={a.num}><b>{money(st.balance)}</b></td>
                                  <td>{day(st.dueDate)}{st.overdue && <span className={`${a.badge} ${s.badgeRed}`}>overdue</span>}</td>
                                  <td><span className={`${a.badge} ${stStatus.cls}`}>{stStatus.label}</span></td>
                                  <td>{['open', 'partially_paid'].includes(st.status) && (
                                    <button className={a.linkBtn} onClick={() => setPaying({ statement: st, companyId: r.id, amount: String(st.balance), method: 'eft', reference: '' })}>Record payment</button>
                                  )}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {rows && shown.length === 0 && <tr><td colSpan={8} className={a.empty}>No accounts here.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className={a.overlay} onClick={() => !busy && setEditing(null)}>
          <div className={a.modal} onClick={e => e.stopPropagation()}>
            <div className={a.cardTitle}>{editing.name}: payment terms</div>
            <label className={a.field}>Payment terms
              <select className={a.input} value={editing.paymentTerms} onChange={e => setEditing(x => ({ ...x, paymentTerms: e.target.value }))}>
                <option value="card">Card — pays by card at each booking</option>
                <option value="monthly">Monthly — books on account, monthly statement</option>
              </select>
            </label>
            {editing.paymentTerms === 'monthly' && <>
              <label className={a.field}>Credit limit (C$)<input className={a.input} type="number" min="0" step="100" value={editing.creditLimit} onChange={e => setEditing(x => ({ ...x, creditLimit: e.target.value }))} /></label>
              <label className={a.field}>Days to pay each statement (Net)<input className={a.input} type="number" min="0" max="120" value={editing.statementTermsDays} onChange={e => setEditing(x => ({ ...x, statementTermsDays: e.target.value }))} /></label>
              <div className={a.sub}>USD bookings count against the limit at the pricing rules&apos; USD→CAD rate. Bookings over the available credit are blocked.</div>
            </>}
            {error && <div className={a.error}>{error}</div>}
            <div className={a.modalActions}>
              <button className={a.btnGhost} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
              <button className={a.btnPrimary} disabled={busy} onClick={saveTerms}>Save</button>
            </div>
          </div>
        </div>
      )}

      {paying && (
        <div className={a.overlay} onClick={() => !busy && setPaying(null)}>
          <div className={a.modal} onClick={e => e.stopPropagation()}>
            <div className={a.cardTitle}>Record payment — {paying.statement.statementNumber}</div>
            <div className={a.sub}>Balance {money(paying.statement.balance)}. A partial payment is fine; the statement is marked paid once the balance is covered.</div>
            <label className={a.field}>Amount received (C$)<input className={a.input} type="number" min="0" step="0.01" value={paying.amount} onChange={e => setPaying(x => ({ ...x, amount: e.target.value }))} /></label>
            <label className={a.field}>Method
              <select className={a.input} value={paying.method} onChange={e => setPaying(x => ({ ...x, method: e.target.value }))}>
                <option value="eft">EFT / bank transfer</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="other">Other</option>
              </select>
            </label>
            <label className={a.field}>Reference<input className={a.input} placeholder="Cheque # / transfer reference" value={paying.reference} onChange={e => setPaying(x => ({ ...x, reference: e.target.value }))} /></label>
            {error && <div className={a.error}>{error}</div>}
            <div className={a.modalActions}>
              <button className={a.btnGhost} disabled={busy} onClick={() => setPaying(null)}>Cancel</button>
              <button className={a.btnPrimary} disabled={busy} onClick={recordPayment}>Record payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
