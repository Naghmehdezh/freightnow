'use client';
import { useState, useEffect } from 'react';
import { fetchAPI, API_URL } from '@/lib/api';
import s from './page.module.css';

const DEMO_INVOICES = [
  { id: 'INV-2026-0052', date: 'May 25, 2026', amount: 'C$312.40', shipments: 1, status: 'pending' },
  { id: 'INV-2026-0051', date: 'May 20, 2026', amount: 'C$456.95', shipments: 2, status: 'paid' },
  { id: 'INV-2026-0050', date: 'May 15, 2026', amount: 'C$228.75', shipments: 1, status: 'paid' },
  { id: 'INV-2026-0049', date: 'May 8, 2026', amount: 'C$185.60', shipments: 1, status: 'paid' },
  { id: 'INV-2026-0048', date: 'Apr 30, 2026', amount: 'C$1,241.50', shipments: 4, status: 'paid' },
];

const DEMO_PAYMENTS = [
  { id: 1, type: 'Visa', last4: '4242', expiry: '08/27', isDefault: true },
  { id: 2, type: 'Mastercard', last4: '8821', expiry: '11/26', isDefault: false },
];

export default function BillingPage() {
  const [invoices, setInvoices] = useState(DEMO_INVOICES);
  const [payments, setPayments] = useState(DEMO_PAYMENTS);
  const [stats, setStats] = useState({ totalSpent: 4218, monthSpent: 1183, outstanding: 312 });
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardForm, setCardForm] = useState({ number: '', expMonth: '', expYear: '', cvc: '', name: '' });
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState('');
  const [userRole, setUserRole] = useState(null);
  const [qbStatus, setQbStatus] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [invoiceData, paymentData, statsData, profileData, qbData] = await Promise.all([
          fetchAPI('/api/billing/invoices').catch(() => null),
          fetchAPI('/api/billing/payment-methods').catch(() => null),
          fetchAPI('/api/billing/stats').catch(() => null),
          fetchAPI('/api/profile').catch(() => null),
          fetchAPI('/api/quickbooks/status').catch(() => null),
        ]);
        if (profileData?.role) setUserRole(profileData.role);
        if (qbData) setQbStatus(qbData);
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
        if (paymentData?.paymentMethods) {
          setPayments(paymentData.paymentMethods.map(pm => ({
            id: pm._id,
            type: pm.type?.charAt(0).toUpperCase() + pm.type?.slice(1),
            last4: pm.last4,
            expiry: `${String(pm.expiryMonth).padStart(2, '0')}/${String(pm.expiryYear).slice(-2)}`,
            isDefault: pm.isDefault,
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
  }, []);

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

  async function handleAddCard(e) {
    e.preventDefault();
    setCardError('');
    setCardLoading(true);
    try {
      const data = await fetchAPI('/api/quickbooks/tokenize-card', {
        method: 'POST',
        body: JSON.stringify(cardForm),
      });
      setPayments(prev => [...prev, {
        id: data.id,
        type: data.type?.charAt(0).toUpperCase() + data.type?.slice(1),
        last4: data.last4,
        expiry: `${String(data.expiryMonth).padStart(2, '0')}/${String(data.expiryYear).slice(-2)}`,
        isDefault: data.isDefault,
      }]);
      setShowCardForm(false);
      setCardForm({ number: '', expMonth: '', expYear: '', cvc: '', name: '' });
    } catch (err) {
      setCardError(err.error?.message || err.message || 'Failed to add card');
    } finally {
      setCardLoading(false);
    }
  }

  return (
    <>
      {/* QuickBooks Connection — IFF admin only */}
      {(userRole === 'iff_admin' || userRole === 'iff_staff') && (
        <div className={`section-card ${s.qbSection}`}>
          <div className={s.sectionTitle}>QuickBooks Connection</div>
          {qbStatus?.connected ? (
            <div className={s.qbConnected}>
              <span className={s.qbDot} />
              <span>Connected to QuickBooks (Realm: {qbStatus.realmId})</span>
              <a href={`${API_URL}/api/quickbooks/connect`} className={s.btnAdd} style={{ marginLeft: 'auto' }}>Reconnect</a>
            </div>
          ) : (
            <div className={s.qbDisconnected}>
              <p className={s.qbMessage}>QuickBooks is not connected. Connect to enable card payments and automatic invoicing.</p>
              <a href={`${API_URL}/api/quickbooks/connect`} className={s.qbConnectBtn}>Connect QuickBooks</a>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className={s.statsRow}>
        <div className={s.statCard}>
          <div className={s.statLabel}>Total spent (all time)</div>
          <div className={s.statValue}>C${stats.totalSpent?.toLocaleString()}</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>This month</div>
          <div className={s.statValue}>C${stats.monthSpent?.toLocaleString()}</div>
        </div>
        <div className={s.statCard}>
          <div className={s.statLabel}>Outstanding</div>
          <div className={s.statValue}>C${stats.outstanding?.toLocaleString()}</div>
        </div>
      </div>

      {/* Payment methods */}
      <div className="section-card">
        <div className={s.sectionTitle}>Company payment methods</div>
        <div className={s.paymentCards}>
          {payments.map(pm => (
            <div key={pm.id} className={`${s.paymentCard} ${pm.isDefault ? s.default : ''}`}>
              <div className={s.cardType}>{pm.type}</div>
              <div className={s.cardNumber}>•••• •••• •••• {pm.last4}</div>
              <div className={s.cardExpiry}>Expires {pm.expiry}</div>
              {pm.isDefault && <div className={s.defaultBadge}>Default</div>}
            </div>
          ))}
        </div>
        <button className={s.btnAdd} onClick={() => setShowCardForm(true)}>+ Add payment method</button>

        {showCardForm && (
          <div className={s.cardFormOverlay} onClick={() => setShowCardForm(false)}>
            <form className={s.cardForm} onClick={e => e.stopPropagation()} onSubmit={handleAddCard}>
              <div className={s.cardFormTitle}>Add payment method</div>
              {cardError && <div className={s.cardFormError}>{cardError}</div>}
              <label className={s.cardFormLabel}>
                Name on card
                <input className={s.cardFormInput} value={cardForm.name} onChange={e => setCardForm(f => ({ ...f, name: e.target.value }))} required />
              </label>
              <label className={s.cardFormLabel}>
                Card number
                <input className={s.cardFormInput} value={cardForm.number} onChange={e => setCardForm(f => ({ ...f, number: e.target.value.replace(/\D/g, '') }))} placeholder="4111111111111111" maxLength={19} required />
              </label>
              <div className={s.cardFormRow}>
                <label className={s.cardFormLabel}>
                  Exp. month
                  <input className={s.cardFormInput} value={cardForm.expMonth} onChange={e => setCardForm(f => ({ ...f, expMonth: e.target.value.replace(/\D/g, '') }))} placeholder="12" maxLength={2} required />
                </label>
                <label className={s.cardFormLabel}>
                  Exp. year
                  <input className={s.cardFormInput} value={cardForm.expYear} onChange={e => setCardForm(f => ({ ...f, expYear: e.target.value.replace(/\D/g, '') }))} placeholder="2027" maxLength={4} required />
                </label>
                <label className={s.cardFormLabel}>
                  CVC
                  <input className={s.cardFormInput} value={cardForm.cvc} onChange={e => setCardForm(f => ({ ...f, cvc: e.target.value.replace(/\D/g, '') }))} placeholder="123" maxLength={4} required />
                </label>
              </div>
              <div className={s.cardFormActions}>
                <button type="button" className={s.btnAdd} onClick={() => setShowCardForm(false)}>Cancel</button>
                <button type="submit" className={s.cardFormSubmit} disabled={cardLoading}>{cardLoading ? 'Adding…' : 'Add card'}</button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Invoices */}
      <div className="section-card">
        <div className={s.sectionTitle}>Invoices</div>
        <div className={s.tableWrap}>
          <table>
            <thead><tr><th>Invoice #</th><th>Date</th><th>Amount</th><th>Shipments</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {invoices.map((inv, i) => (
                <tr key={i}>
                  <td>{inv.id}</td>
                  <td>{inv.date}</td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{inv.amount}</td>
                  <td>{inv.shipments}</td>
                  <td><span className={`${s.badge} ${getBadgeClass(inv.status)}`}>{inv.status}</span></td>
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
