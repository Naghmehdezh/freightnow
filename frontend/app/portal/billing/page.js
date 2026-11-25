'use client';
import { useState, useEffect } from 'react';
import { fetchAPI } from '@/lib/api';
import { emptyCard, cardProblem, tokenizeCard } from '@/lib/cardPayments';
import CardFields from '@/components/CardFields';
import s from './page.module.css';

const DEMO_INVOICES = [
  { id: 'INV-2026-0052', date: 'May 25, 2026', amount: 'C$312.40', shipments: 1, status: 'pending' },
  { id: 'INV-2026-0051', date: 'May 20, 2026', amount: 'C$456.95', shipments: 2, status: 'paid' },
  { id: 'INV-2026-0050', date: 'May 15, 2026', amount: 'C$228.75', shipments: 1, status: 'paid' },
  { id: 'INV-2026-0049', date: 'May 8, 2026', amount: 'C$185.60', shipments: 1, status: 'paid' },
  { id: 'INV-2026-0048', date: 'Apr 30, 2026', amount: 'C$1,241.50', shipments: 4, status: 'paid' },
];

const cap = v => (v ? `${v[0].toUpperCase()}${v.slice(1)}` : v);

export default function BillingPage() {
  const [invoices, setInvoices] = useState(DEMO_INVOICES);
  const [stats, setStats] = useState({ totalSpent: 4218, monthSpent: 1183, outstanding: 312 });
  const [userRole, setUserRole] = useState(null);
  const [qbStatus, setQbStatus] = useState(null);
  const [qbBusy, setQbBusy] = useState(false);
  const [qbMessage, setQbMessage] = useState(null); // { ok, text } after returning from Intuit
  // Price adjustments (carrier re-weigh/re-measure), store credit and account hold.
  const [balances, setBalances] = useState({ adjustments: [], credit: { CAD: 0, USD: 0 }, accountHold: { active: false } });
  const [payConfig, setPayConfig] = useState(null);
  const [paying, setPaying] = useState(null); // adjustment being paid
  const [disputing, setDisputing] = useState(null); // adjustment being disputed
  const [card, setCard] = useState(emptyCard());
  const [disputeReason, setDisputeReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadBalances = () => fetchAPI('/api/adjustments').then(setBalances).catch(() => {});
  const [account, setAccount] = useState(null); // monthly terms: credit limit, used, statements
  const [awaiting, setAwaiting] = useState([]); // bookings reserved with a QuickBooks payment link
  const loadAwaiting = () => fetchAPI('/api/bookings?status=awaiting_payment&limit=50').then(d => setAwaiting(d.data || d.bookings || [])).catch(() => {});

  useEffect(() => {
    async function load() {
      try {
        const [invoiceData, statsData, profileData] = await Promise.all([
          fetchAPI('/api/billing/invoices').catch(() => null),
          fetchAPI('/api/billing/stats').catch(() => null),
          fetchAPI('/api/profile').catch(() => null),
        ]);
        if (profileData?.role) setUserRole(profileData.role);
        loadBalances();
        fetchAPI('/api/billing/account').then(setAccount).catch(() => {});
        loadAwaiting();
        fetchAPI('/api/quickbooks/payments-config').then(setPayConfig).catch(() => {});
        // Connection details are for IFF admins only.
        if (profileData?.role === 'iff_admin') setQbStatus(await fetchAPI('/api/quickbooks/status').catch(() => null));
        if (invoiceData?.invoices) {
          setInvoices(invoiceData.invoices.map(inv => ({
            _id: inv._id,
            id: inv.invoiceNumber || inv._id,
            date: inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
            amount: `C$${inv.totalAmount?.toLocaleString()}`,
            rawAmount: inv.totalAmount,
            currency: inv.currency || 'CAD',
            shipments: inv.items?.length || 0,
            items: inv.items || [],
            status: inv.status,
            issuedAt: inv.issuedAt,
            paidAt: inv.paidAt,
          })));
        }
        if (statsData) {
          setStats({
            totalSpent: statsData.spentThisYear || 0,
            monthSpent: statsData.spentThisMonth || 0,
            outstanding: statsData.outstanding || 0,
          });
        }
      } catch {}
    }
    load();
    // Back from Intuit's sign-in page.
    const params = new URLSearchParams(window.location.search);
    if (params.get('qb_connected')) setQbMessage({ ok: true, text: 'QuickBooks sandbox connected.' });
    if (params.get('qb_error')) setQbMessage({ ok: false, text: `QuickBooks was not connected: ${params.get('qb_error')}` });
    if (params.get('qb_connected') || params.get('qb_error')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // Connect: the backend gives a signed Intuit sign-in link for this admin; Intuit sends the
  // admin back to this page afterwards.
  async function connectQuickBooks() {
    setQbBusy(true);
    try {
      const { url } = await fetchAPI('/api/quickbooks/connect-url');
      window.location.href = url;
    } catch (err) {
      setQbMessage({ ok: false, text: err.error?.message || 'Could not start the QuickBooks connection.' });
      setQbBusy(false);
    }
  }

  const money = (n, cur) => `${cur === 'USD' ? 'US$' : 'C$'}${Number(n || 0).toFixed(2)}`;
  const day = d => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '');

  // Pay a balance: store credit first (server side), the rest by card via a one-time token.
  async function payBalance() {
    setActionError('');
    const creditAvail = Number(balances.credit?.[paying.currency] || 0);
    const needsCard = paying.amountDue - creditAvail > 0;
    if (needsCard) {
      const problem = cardProblem(card);
      if (problem) { setActionError(`Please enter ${problem}.`); return; }
      if (!payConfig?.cardTokenUrl) { setActionError('Card payments are still loading. Try again in a moment.'); return; }
    }
    setBusy(true);
    try {
      const cardToken = needsCard ? await tokenizeCard(payConfig.cardTokenUrl, card) : undefined;
      await fetchAPI(`/api/adjustments/${paying.id}/pay`, { method: 'POST', body: JSON.stringify(cardToken ? { cardToken } : {}) });
      setPaying(null); setCard(emptyCard());
      await loadBalances();
    } catch (err) {
      setActionError(err.error?.message || err.message || 'Payment failed.');
    } finally {
      setBusy(false);
    }
  }

  async function sendDispute() {
    setActionError('');
    if (disputeReason.trim().length < 10) { setActionError('Please tell us why (at least a sentence).'); return; }
    setBusy(true);
    try {
      await fetchAPI(`/api/adjustments/${disputing.id}/dispute`, { method: 'POST', body: JSON.stringify({ reason: disputeReason.trim() }) });
      setDisputing(null); setDisputeReason('');
      await loadBalances();
    } catch (err) {
      setActionError(err.error?.message || 'Could not send the dispute.');
    } finally {
      setBusy(false);
    }
  }

  async function checkAwaiting(b) {
    try {
      const r = await fetchAPI(`/api/bookings/${b._id || b.id}/check-payment`, { method: 'POST' });
      if (!r.paid) alert(r.status === 'cancelled' ? 'This reservation was cancelled because it was not paid in time.' : 'We haven\'t received the payment yet. It can take a minute after you pay.');
      loadAwaiting();
    } catch (err) { alert(err.error?.message || 'Could not check the payment.'); }
  }

  async function testPayAwaiting(b) {
    try {
      const r = await fetchAPI(`/api/bookings/${b._id || b.id}/test-payment`, { method: 'POST' });
      alert(r.paid ? `Test payment recorded. Booking ${b.bookingNumber} is now booked with the carrier.` : 'Recorded, but not confirmed yet. Check again in a moment.');
      loadAwaiting();
    } catch (err) { alert(err.error?.message || 'Could not record the test payment.'); }
  }

  async function downloadStatement(st) {
    const html2pdf = (await import('html2pdf.js')).default;
    const cad = n => `C$${Number(n || 0).toFixed(2)}`;
    const amt = (n, c) => `${c === 'USD' ? 'US$' : 'C$'}${Number(n || 0).toFixed(2)}`;
    const rows = st.lines.map(l => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${new Date(l.issuedAt).toLocaleDateString('en-CA')}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${l.invoiceNumber}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${l.description}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">${amt(l.amount, l.currency)}</td></tr>`).join('');
    const container = document.createElement('div');
    container.innerHTML = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px;color:#1a1a2e;">
  <div style="display:flex;justify-content:space-between;margin-bottom:32px;">
    <div><div style="font-size:24px;font-weight:700;">IFF <span style="color:#2563eb;">Cargo</span></div>
      <div style="font-size:12px;color:#666;line-height:1.6;">International Freight Forwarders<br>286 Attwell Drive, Unit 16<br>Toronto, ON M9W 5B2<br>416-798-4151</div></div>
    <div style="text-align:right;font-size:12px;color:#666;line-height:1.6;">info@iffcargo.com<br>www.iffcargo.com</div>
  </div>
  <div style="font-size:26px;font-weight:700;margin-bottom:4px;">Statement ${st.statementNumber}</div>
  <div style="font-size:13px;color:#666;margin-bottom:24px;">Period: <strong>${st.period}</strong> &nbsp; Issued: <strong>${new Date(st.issuedAt).toLocaleDateString('en-CA')}</strong> &nbsp; Due: <strong>${new Date(st.dueDate).toLocaleDateString('en-CA')}</strong></div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px;">
    <thead><tr><th style="text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;color:#64748b;">DATE</th><th style="text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;color:#64748b;">INVOICE</th><th style="text-align:left;padding:8px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;color:#64748b;">DESCRIPTION</th><th style="text-align:right;padding:8px 10px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:11px;color:#64748b;">AMOUNT</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <table style="margin-left:auto;font-size:13px;">
    ${st.totals?.USD > 0 ? `<tr><td style="padding:3px 12px;color:#666">USD invoices (at ${st.fxRate} CAD/USD)</td><td style="text-align:right;font-family:monospace">US$${st.totals.USD.toFixed(2)}</td></tr>` : ''}
    <tr><td style="padding:3px 12px;color:#666">Total (CAD)</td><td style="text-align:right;font-family:monospace">${cad(st.totalCad)}</td></tr>
    ${st.creditApplied > 0 ? `<tr><td style="padding:3px 12px;color:#666">Store credit</td><td style="text-align:right;font-family:monospace">− ${cad(st.creditApplied)}</td></tr>` : ''}
    ${st.paidAmount > 0 ? `<tr><td style="padding:3px 12px;color:#666">Paid</td><td style="text-align:right;font-family:monospace">− ${cad(st.paidAmount)}</td></tr>` : ''}
    <tr><td style="padding:8px 12px;font-weight:700;font-size:15px;border-top:2px solid #1a1a2e">Balance due</td><td style="text-align:right;font-weight:700;font-size:15px;font-family:monospace;border-top:2px solid #1a1a2e">${cad(st.balance)}</td></tr>
  </table>
  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">Please pay by ${new Date(st.dueDate).toLocaleDateString('en-CA')} by EFT or cheque payable to International Freight Forwarders, quoting ${st.statementNumber}.</div>
</div>`;
    await html2pdf().set({ margin: 0, filename: `${st.statementNumber}.pdf`, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } }).from(container).save();
  }

  async function disconnectQuickBooks() {
    setQbBusy(true);
    try {
      setQbStatus(await fetchAPI('/api/quickbooks/disconnect', { method: 'POST' }));
      setQbMessage({ ok: true, text: 'QuickBooks disconnected. Card bookings will be refused until it is connected again.' });
    } catch (err) {
      setQbMessage({ ok: false, text: err.error?.message || 'Could not disconnect QuickBooks.' });
    } finally {
      setQbBusy(false);
    }
  }

  function getBadgeClass(status) {
    if (status === 'paid') return s.badgePaid;
    if (status === 'pending') return s.badgePending;
    return s.badgeOverdue;
  }

  async function downloadInvoice(inv) {
    const html2pdf = (await import('html2pdf.js')).default;

    const issuedDate = inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const paidDate = inv.paidAt ? new Date(inv.paidAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    const itemRows = (inv.items || []).map(item =>
      `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee">${item.description}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">$${item.amount?.toFixed(2)}</td></tr>`
    ).join('');

    const container = document.createElement('div');
    container.innerHTML = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:40px;color:#1a1a2e;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;">
    <div>
      <div style="font-size:24px;font-weight:700;color:#1a1a2e;">IFF <span style="color:#2563eb;">Cargo</span></div>
      <div style="font-size:12px;color:#666;line-height:1.6;">International Freight Forwarders<br>286 Attwell Drive, Unit 16<br>Toronto, ON M9W 5B2<br>416-798-4151</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;color:#666;line-height:1.6;">info@iffcargo.com<br>www.iffcargo.com</div>
    </div>
  </div>
  <div style="font-size:28px;font-weight:700;margin-bottom:4px;">Invoice ${inv.id}</div>
  <div style="font-size:13px;color:#666;margin-bottom:32px;">
    <span style="display:inline-block;margin-right:24px;"><strong>Issued:</strong> ${issuedDate}</span>
    ${paidDate ? `<span style="display:inline-block;margin-right:24px;"><strong>Paid:</strong> ${paidDate}</span>` : ''}
    <span style="display:inline-block;margin-right:24px;"><strong>Currency:</strong> ${inv.currency}</span>
    <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600;text-transform:uppercase;${inv.status === 'paid' ? 'background:#dcfce7;color:#166534;' : 'background:#fef3c7;color:#92400e;'}">${inv.status}</span>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead><tr><th style="text-align:left;padding:10px 12px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:12px;text-transform:uppercase;color:#64748b;">Description</th><th style="text-align:right;padding:10px 12px;background:#f8fafc;border-bottom:2px solid #e2e8f0;font-size:12px;text-transform:uppercase;color:#64748b;">Amount</th></tr></thead>
    <tbody>
      ${itemRows || `<tr><td style="padding:8px 12px">Freight services</td><td style="padding:8px 12px;text-align:right;font-family:monospace">$${inv.rawAmount?.toFixed(2)}</td></tr>`}
    </tbody>
    <tfoot><tr><td style="font-weight:700;font-size:16px;padding:12px;border-top:2px solid #1a1a2e;">Total</td><td style="font-weight:700;font-size:16px;padding:12px;text-align:right;font-family:monospace;border-top:2px solid #1a1a2e;">${inv.currency} $${inv.rawAmount?.toFixed(2)}</td></tr></tfoot>
  </table>
  <div style="margin-top:48px;padding-top:24px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
    Thank you for shipping with IFF Cargo &mdash; International Freight Forwarders &mdash; Trusted since 1993
  </div>
</div>`;

    await html2pdf().set({
      margin: 0,
      filename: `${inv.id}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    }).from(container).save();
  }

  return (
    <>
      {/* QuickBooks Connection — IFF admin only (sandbox for now) */}
      {userRole === 'iff_admin' && (
        <div className={`section-card ${s.qbSection}`}>
          <div className={s.sectionTitle}>QuickBooks connection <span className={s.sandboxTag}>Sandbox</span></div>
          {qbMessage && <div className={qbMessage.ok ? s.qbNoticeOk : s.qbNoticeError}>{qbMessage.text}</div>}
          {qbStatus?.connected ? (
            <div className={s.qbConnected}>
              <span className={s.qbDot} />
              <span>
                Connected to QuickBooks sandbox company {qbStatus.realmId}
                {qbStatus.connectedBy && <>, by {qbStatus.connectedBy}</>}
                {qbStatus.connectedAt && <> on {new Date(qbStatus.connectedAt).toLocaleDateString('en-CA')}</>}
              </span>
              <span className={s.qbActions}>
                <button className={s.btnAdd} disabled={qbBusy} onClick={connectQuickBooks}>Reconnect</button>
                <button className={s.btnAdd} disabled={qbBusy} onClick={disconnectQuickBooks}>Disconnect</button>
              </span>
            </div>
          ) : (
            <div className={s.qbDisconnected}>
              <p className={s.qbMessage}>QuickBooks is not connected. Connect IFF&apos;s QuickBooks sandbox company to take card payments at booking.</p>
              <button className={s.qbConnectBtn} disabled={qbBusy} onClick={connectQuickBooks}>{qbBusy ? 'Opening Intuit…' : 'Connect QuickBooks'}</button>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className={s.statsRow}>
        <div className={s.statCard}>
          <div className={s.statLabel}>Spent, all time</div>
          <div className={s.statValue}>C${stats.totalSpent?.toLocaleString()}</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Spent this month</div>
          <div className={s.statValue}>C${stats.monthSpent?.toLocaleString()}</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Outstanding</div>
          <div className={s.statValue}>C${stats.outstanding?.toLocaleString()}</div>
        </div>
      </div>

      {/* Bookings reserved with a QuickBooks payment link */}
      {awaiting.length > 0 && (
        <div className="section-card">
          <div className={s.sectionTitle}>Awaiting payment</div>
          <p className={s.qbMessage}>These bookings are reserved. Pay each one on its QuickBooks payment page; the carrier is booked as soon as it&apos;s paid. Unpaid reservations are cancelled after 24 hours.</p>
          <div className={s.tableWrap}>
            <table>
              <thead><tr><th>Booking</th><th>Carrier</th><th>Amount</th><th>Pay by</th><th></th></tr></thead>
              <tbody>
                {awaiting.map(b => (
                  <tr key={b._id || b.id}>
                    <td>{b.bookingNumber}</td>
                    <td>{b.carrierName}<div className={s.muted}>{b.serviceName}</div></td>
                    <td className={s.money}>{money(b.chargeAmount ?? b.sellRate, b.chargeCurrency || b.currency)}</td>
                    <td>{b.payBy ? new Date(b.payBy).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</td>
                    <td className={s.actions}>
                      {b.qbInvoiceLink && !/developer\.intuit\.com\/comingSoon/.test(b.qbInvoiceLink)
                        ? <a className={s.btnDownload} href={b.qbInvoiceLink} target="_blank" rel="noopener noreferrer">Pay now</a>
                        : <button className={s.btnDownload} onClick={() => testPayAwaiting(b)}>Test payment (sandbox)</button>}{' '}
                      <button className={s.btnDownload} onClick={() => checkAwaiting(b)}>Check payment</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Monthly terms: credit limit and statements */}
      {account?.paymentTerms === 'monthly' && (
        <div className="section-card">
          <div className={s.sectionTitle}>Monthly account, Net {account.statementTermsDays}</div>
          <div className={`${s.statsRow} ${s.statsInset}`}>
            <div className={s.statCard}><div className={s.statLabel}>Credit limit</div><div className={s.statValue}>{money(account.creditLimit, 'CAD')}</div></div>
            <div className={s.statCard}><div className={s.statLabel}>Used</div><div className={s.statValue}>{money(account.used, 'CAD')}</div></div>
            <div className={s.statCard}><div className={s.statLabel}>Available</div><div className={s.statValue}>{money(Math.max(0, account.available), 'CAD')}</div></div>
          </div>
          <p className={s.qbMessage}>Each booking is invoiced to your account. On the 1st of each month you receive one statement for the previous month, due in {account.statementTermsDays} days. USD bookings count against your limit at C${account.fxRate} per US$1.</p>
          {account.statements?.length > 0 && (
            <div className={s.tableWrap}>
              <table>
                <thead><tr><th>Statement</th><th>Period</th><th className={s.right}>Total</th><th className={s.right}>Balance</th><th>Due</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {account.statements.map(st => (
                    <tr key={st.id}>
                      <td>{st.statementNumber}<div className={s.muted}>{st.lines.length} invoice(s)</div></td>
                      <td>{st.period}</td>
                      <td className={s.money}>{money(st.amountDue, 'CAD')}</td>
                      <td className={s.money}>{money(st.balance, 'CAD')}</td>
                      <td>{day(st.dueDate)}</td>
                      <td><span className={`${s.badge} ${st.status === 'paid' ? s.badgePaid : st.overdue ? s.badgeOverdue : s.badgePending}`}>{st.overdue ? 'Overdue' : cap(st.status.replace('_', ' '))}</span></td>
                      <td><button className={s.btnDownload} onClick={() => downloadStatement(st)}>Download PDF</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Account hold (overdue adjustment) */}
      {balances.accountHold?.active && (
        <div className={s.holdBanner}>
          <strong>Your account is on hold.</strong> {balances.accountHold.reason ? `${balances.accountHold.reason[0].toUpperCase()}${balances.accountHold.reason.slice(1)}` : 'A balance is overdue'}, so new bookings are paused. Pay the overdue balance to continue booking.
        </div>
      )}

      {/* Balance due — price adjustments after the carrier re-weighed / re-measured a shipment */}
      {(balances.adjustments.length > 0 || balances.credit?.CAD > 0 || balances.credit?.USD > 0) && (
        <div className="section-card">
          <div className={s.sectionTitle}>Balance due &amp; price adjustments</div>
          {(balances.credit?.CAD > 0 || balances.credit?.USD > 0) && (
            <p className={s.qbMessage}>
              Store credit: {[balances.credit.CAD > 0 && money(balances.credit.CAD, 'CAD'), balances.credit.USD > 0 && money(balances.credit.USD, 'USD')].filter(Boolean).join(' and ')}, used automatically on your next booking.
            </p>
          )}
          {balances.adjustments.length > 0 && (
            <div className={s.tableWrap}>
              <table>
                <thead><tr><th>Adjustment</th><th>Booking</th><th>What changed</th><th>Quoted, then new price</th><th className={s.right}>Amount</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {balances.adjustments.map(a => (
                    <tr key={a.id}>
                      <td>{a.adjustmentNumber}<div className={s.muted}>{day(a.sentAt)}</div></td>
                      <td>{a.booking?.bookingNumber}<div className={s.muted}>{a.booking?.carrierName}</div></td>
                      <td>
                        {a.reason.replace('_', ' ')}
                        {a.measured?.weight && <div className={s.muted}>Weight: {a.entered?.weight} → {a.measured.weight} lb</div>}
                        {a.measured?.length && <div className={s.muted}>Size: {a.entered?.length}×{a.entered?.width}×{a.entered?.height} → {a.measured.length}×{a.measured.width}×{a.measured.height} in</div>}
                        {a.measured?.freightClass && <div className={s.muted}>Class: {a.entered?.freightClass || '—'} → {a.measured.freightClass}</div>}
                      </td>
                      <td>{money(a.originalPrice, a.currency)} → {money(a.newPrice, a.currency)}{a.adminFee > 0 && <div className={s.muted}>+ {money(a.adminFee, a.currency)} adjustment fee</div>}</td>
                      <td className={s.money}>
                        {a.amountDue > 0 ? money(a.amountDue, a.currency) : a.creditAmount > 0 ? `− ${money(a.creditAmount, a.currency)}` : '—'}
                      </td>
                      <td>
                        <span className={`${s.badge} ${a.status === 'paid' || a.status === 'credited' || a.status === 'refunded' || a.status === 'waived' || a.status === 'absorbed' ? s.badgePaid : a.overdue ? s.badgeOverdue : s.badgePending}`}>
                          {a.overdue ? 'Overdue' : cap(a.status)}
                        </span>
                        {a.status === 'sent' && a.dueDate && <div className={s.muted}>Due {day(a.dueDate)}</div>}
                      </td>
                      <td className={s.actions}>
                        {a.status === 'sent' && (
                          <>
                            <button className={s.btnDownload} onClick={() => { setPaying(a); setActionError(''); }}>Pay</button>{' '}
                            <button className={s.btnDownload} onClick={() => { setDisputing(a); setActionError(''); }}>Dispute</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pay a balance */}
      {paying && (
        <div className={s.cardFormOverlay} onClick={() => !busy && setPaying(null)}>
          <div className={s.cardForm} onClick={e => e.stopPropagation()}>
            <div className={s.cardFormTitle}>Pay {paying.adjustmentNumber}: {money(paying.amountDue, paying.currency)}</div>
            {Number(balances.credit?.[paying.currency] || 0) > 0 && (
              <p className={s.qbMessage}>Your store credit of {money(balances.credit[paying.currency], paying.currency)} is used first.</p>
            )}
            {paying.amountDue - Number(balances.credit?.[paying.currency] || 0) > 0 && (
              <>
                <CardFields card={card} onChange={setCard} />
                <p className={s.muted}>Card details go directly to QuickBooks Payments; IFF doesn&apos;t see or store them.{payConfig?.environment === 'sandbox' && ' (Test mode: use 4111 1111 1111 1111.)'}</p>
              </>
            )}
            {actionError && <div className={s.cardFormError}>{actionError}</div>}
            <div className={s.cardFormActions}>
              <button type="button" className={s.btnAdd} disabled={busy} onClick={() => setPaying(null)}>Cancel</button>
              <button type="button" className={s.cardFormSubmit} disabled={busy} onClick={payBalance}>{busy ? 'Paying…' : 'Pay now'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Dispute a balance */}
      {disputing && (
        <div className={s.cardFormOverlay} onClick={() => !busy && setDisputing(null)}>
          <div className={s.cardForm} onClick={e => e.stopPropagation()}>
            <div className={s.cardFormTitle}>Dispute {disputing.adjustmentNumber}</div>
            <p className={s.qbMessage}>Tell us why you think the carrier&apos;s measurement is wrong (for example, attach details of your own scale ticket in your message). IFF will review it with the carrier; the payment clock stops while it&apos;s under review.</p>
            <textarea className={s.cardFormInput} rows={4} value={disputeReason} onChange={e => setDisputeReason(e.target.value)} />
            {actionError && <div className={s.cardFormError}>{actionError}</div>}
            <div className={s.cardFormActions}>
              <button type="button" className={s.btnAdd} disabled={busy} onClick={() => setDisputing(null)}>Cancel</button>
              <button type="button" className={s.cardFormSubmit} disabled={busy} onClick={sendDispute}>{busy ? 'Sending…' : 'Send dispute'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Card payments — entered at each booking, never stored */}
      <div className="section-card">
        <div className={s.sectionTitle}>Card payments</div>
        <p className={s.qbMessage}>
          You enter your card when you book a shipment, and it&apos;s charged once for that booking.
          Card details go straight to our payment processor, QuickBooks Payments. IFF never sees or stores them.
        </p>
      </div>

      {/* Invoices */}
      <div className="section-card">
        <div className={s.sectionTitle}>Invoices</div>
        <div className={s.tableWrap}>
          <table>
            <thead><tr><th>Invoice</th><th>Date</th><th className={s.right}>Amount</th><th>Shipments</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={i}>
                  <td className="ref">{inv.id}</td>
                  <td>{inv.date}</td>
                  <td className={s.money}>{inv.amount}</td>
                  <td>{inv.shipments}</td>
                  <td><span className={`${s.badge} ${getBadgeClass(inv.status)}`}>{cap(inv.status)}</span></td>
                  <td><button className={s.btnDownload} onClick={() => downloadInvoice(inv)}>Download PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
