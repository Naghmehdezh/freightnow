'use client';
import { useState, useEffect } from 'react';
import { fetchAPI } from '@/lib/api';
import s from './page.module.css';

const DEMO_CLAIMS = [
  { id: 'CLM-2026-0041', shipmentId: 'IFF-2026-00320', type: 'Damage', amount: 'C$450.00', filed: 'May 15, 2026', status: 'approved' },
  { id: 'CLM-2026-0040', shipmentId: 'IFF-2026-00318', type: 'Lost package', amount: 'C$1,200.00', filed: 'May 12, 2026', status: 'pending' },
  { id: 'CLM-2026-0039', shipmentId: 'IFF-2026-00315', type: 'Delay', amount: 'C$85.00', filed: 'May 8, 2026', status: 'denied' },
  { id: 'CLM-2026-0038', shipmentId: 'IFF-2026-00310', type: 'Damage', amount: 'C$320.00', filed: 'Apr 28, 2026', status: 'approved' },
];

export default function ClaimsPage() {
  const [claims, setClaims] = useState(DEMO_CLAIMS);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ shipmentId: '', type: 'Damage', amount: '', description: '' });

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAPI('/api/claims');
        if (data.claims?.length) setClaims(data.claims);
      } catch {}
    }
    load();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      await fetchAPI('/api/claims', { method: 'POST', body: JSON.stringify(formData) });
      setShowForm(false);
      const data = await fetchAPI('/api/claims');
      if (data.claims) setClaims(data.claims);
    } catch {
      setShowForm(false);
    }
  }

  function getBadgeClass(status) {
    if (status === 'approved') return s.badgeApproved;
    if (status === 'denied') return s.badgeDenied;
    if (status === 'pending') return s.badgePending;
    return s.badgeOpen;
  }

  return (
    <>
      <div className="section-card">
        <div className={s.header}>
          <div>
            <div className={s.title}>Your claims</div>
            <div className={s.sub}>{claims.length} {claims.length === 1 ? 'claim' : 'claims'} filed</div>
          </div>
          <button type="button" className={s.btnNew} onClick={() => setShowForm(true)}>
            File a claim
          </button>
        </div>

        <div className={s.tableWrap}>
          <table>
            <thead><tr><th>Claim</th><th>Shipment</th><th>Type</th><th className={s.right}>Amount</th><th>Filed</th><th>Status</th></tr></thead>
            <tbody>
              {claims.map((claim, i) => (
                <tr key={i}>
                  <td className="ref">{claim.id}</td>
                  <td className="ref">{claim.shipmentId}</td>
                  <td>{claim.type}</td>
                  <td className={s.money}>{claim.amount}</td>
                  <td>{claim.filed}</td>
                  <td><span className={`${s.badge} ${getBadgeClass(claim.status)}`}>{claim.status ? `${claim.status[0].toUpperCase()}${claim.status.slice(1).replace('_', ' ')}` : ''}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className={s.formOverlay} onClick={() => setShowForm(false)}>
          <form className={s.formCard} onClick={e => e.stopPropagation()} onSubmit={handleSubmit} role="dialog" aria-modal="true" aria-labelledby="claim-form-title">
            <div className={s.formTitle} id="claim-form-title">File a claim</div>
            <div className="field"><label>Tracking number</label><input placeholder="IFF-2026-XXXXX" value={formData.shipmentId} onChange={e => setFormData({ ...formData, shipmentId: e.target.value })} required /></div>
            <div className="grid2">
              <div className="field"><label>Claim type</label>
                <select value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}>
                  <option>Damage</option><option>Lost package</option><option>Delay</option><option>Other</option>
                </select>
              </div>
              <div className="field"><label>Claim amount (CAD)</label><input type="number" min="0" step="0.01" placeholder="0.00" value={formData.amount} onChange={e => setFormData({ ...formData, amount: e.target.value })} required /></div>
            </div>
            <div className="field"><label>Description</label><textarea rows="3" placeholder="Describe what happened…" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} required /></div>
            <div className={s.formActions}>
              <button type="button" className={s.btnCancel} onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className={s.btnSubmit}>Submit claim</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
