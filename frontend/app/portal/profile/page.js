'use client';
import { useState, useEffect } from 'react';
import { fetchAPI } from '@/lib/api';
import s from './page.module.css';

export default function ProfilePage() {
  const [profile, setProfile] = useState({ firstName: '', lastName: '', email: '' });
  const [company, setCompany] = useState({ name: '', street: '', city: '', province: '', postalCode: '', country: 'CA', phone: '', taxNumber: '' });
  const [password, setPassword] = useState({ current: '', newPass: '', confirm: '' });
  const [editingProfile, setEditingProfile] = useState(false);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editingPassword, setEditingPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchAPI('/api/profile');
        if (data) {
          setProfile({ firstName: data.firstName || '', lastName: data.lastName || '', email: data.email || '' });
          if (data.company) {
            const c = data.company;
            setCompany({
              name: c.name || '', street: c.street || '', city: c.city || '',
              province: c.province || '', postalCode: c.postalCode || '',
              country: c.country || 'CA', phone: c.phone || '', taxNumber: c.taxNumber || '',
            });
          }
        }
      } catch {}
    }
    load();
  }, []);

  async function handleSaveProfile(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    try {
      await fetchAPI('/api/profile', { method: 'PUT', body: JSON.stringify(profile) });
      setSuccess('Profile updated successfully.');
      setEditingProfile(false);
    } catch {}
    setSaving(false);
  }

  async function handleSaveCompany(e) {
    e.preventDefault();
    setSaving(true);
    setSuccess('');
    try {
      await fetchAPI('/api/profile/company', { method: 'PUT', body: JSON.stringify(company) });
      setSuccess('Company info updated.');
      setEditingCompany(false);
    } catch {}
    setSaving(false);
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    if (password.newPass !== password.confirm) { alert('Passwords do not match.'); return; }
    setSaving(true);
    setSuccess('');
    try {
      await fetchAPI('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: password.current, newPassword: password.newPass }) });
      setSuccess('Password changed.');
      setPassword({ current: '', newPass: '', confirm: '' });
    } catch {}
    setSaving(false);
  }

  return (
    <>
      {success && <div className={s.success}>{success}</div>}

      <div className="section-card">
        <div className={s.sectionHeader}>
          <div className={s.sectionTitle}>Personal Information</div>
          {!editingProfile && <button type="button" className={s.btnEdit} onClick={() => setEditingProfile(true)}>Edit</button>}
        </div>
        <form onSubmit={handleSaveProfile}>
          <div className="grid2">
            <div className="field"><label>First name</label><input value={profile.firstName} onChange={e => setProfile({ ...profile, firstName: e.target.value })} readOnly={!editingProfile} className={!editingProfile ? s.readOnly : ''} /></div>
            <div className="field"><label>Last name</label><input value={profile.lastName} onChange={e => setProfile({ ...profile, lastName: e.target.value })} readOnly={!editingProfile} className={!editingProfile ? s.readOnly : ''} /></div>
          </div>
          <div className="field"><label>Email</label><input type="email" value={profile.email} readOnly className={s.readOnly} /></div>
          {editingProfile && (
            <div className={s.btnRow}>
              <button type="submit" className={s.btnSave} disabled={saving}>Save</button>
              <button type="button" className={s.btnCancel} onClick={() => setEditingProfile(false)}>Cancel</button>
            </div>
          )}
        </form>
      </div>

      <div className="section-card">
        <div className={s.sectionHeader}>
          <div className={s.sectionTitle}>Company</div>
          {!editingCompany && <button type="button" className={s.btnEdit} onClick={() => setEditingCompany(true)}>Edit</button>}
        </div>
        <form onSubmit={handleSaveCompany}>
          <div className="field"><label>Company name</label><input value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} readOnly={!editingCompany} className={!editingCompany ? s.readOnly : ''} /></div>
          <div className="field"><label>Street address</label><input value={company.street} onChange={e => setCompany({ ...company, street: e.target.value })} placeholder={editingCompany ? '123 Main St, Unit 4' : ''} readOnly={!editingCompany} className={!editingCompany ? s.readOnly : ''} /></div>
          <div className="grid2">
            <div className="field"><label>City</label><input value={company.city} onChange={e => setCompany({ ...company, city: e.target.value })} readOnly={!editingCompany} className={!editingCompany ? s.readOnly : ''} /></div>
            <div className="field"><label>Province / State</label><input value={company.province} onChange={e => setCompany({ ...company, province: e.target.value })} readOnly={!editingCompany} className={!editingCompany ? s.readOnly : ''} /></div>
          </div>
          <div className="grid2">
            <div className="field"><label>Postal code</label><input value={company.postalCode} onChange={e => setCompany({ ...company, postalCode: e.target.value })} readOnly={!editingCompany} className={!editingCompany ? s.readOnly : ''} /></div>
            <div className="field"><label>Country</label>
              {editingCompany ? (
                <select value={company.country} onChange={e => setCompany({ ...company, country: e.target.value })}>
                  <option value="CA">Canada</option><option value="US">United States</option>
                </select>
              ) : (
                <input value={company.country === 'CA' ? 'Canada' : 'United States'} readOnly className={s.readOnly} />
              )}
            </div>
          </div>
          <div className="grid2">
            <div className="field"><label>Phone</label><input value={company.phone} onChange={e => setCompany({ ...company, phone: e.target.value })} placeholder={editingCompany ? '416 555 0100' : ''} readOnly={!editingCompany} className={!editingCompany ? s.readOnly : ''} /></div>
            <div className="field"><label>Tax number (GST/HST)</label><input value={company.taxNumber} onChange={e => setCompany({ ...company, taxNumber: e.target.value })} placeholder={editingCompany ? '123456789RT0001' : ''} readOnly={!editingCompany} className={!editingCompany ? s.readOnly : ''} /></div>
          </div>
          {editingCompany && (
            <div className={s.btnRow}>
              <button type="submit" className={s.btnSave} disabled={saving}>Save</button>
              <button type="button" className={s.btnCancel} onClick={() => setEditingCompany(false)}>Cancel</button>
            </div>
          )}
        </form>
      </div>

      <div className="section-card">
        <div className={s.sectionHeader}>
          <div className={s.sectionTitle}>Password</div>
          {!editingPassword && <button type="button" className={s.btnEdit} onClick={() => setEditingPassword(true)}>Change password</button>}
        </div>
        {!editingPassword && (
          <p className={s.hint}>Use the button above to update your password.</p>
        )}
        {editingPassword && (
          <form onSubmit={handleChangePassword}>
            <div className="field"><label>Current password</label><input type="password" value={password.current} onChange={e => setPassword({ ...password, current: e.target.value })} required /></div>
            <div className="grid2">
              <div className="field"><label>New password</label><input type="password" value={password.newPass} onChange={e => setPassword({ ...password, newPass: e.target.value })} required /></div>
              <div className="field"><label>Confirm new password</label><input type="password" value={password.confirm} onChange={e => setPassword({ ...password, confirm: e.target.value })} required /></div>
            </div>
            <div className={s.btnRow}>
              <button type="submit" className={s.btnSave} disabled={saving}>Update password</button>
              <button type="button" className={s.btnCancel} onClick={() => { setEditingPassword(false); setPassword({ current: '', newPass: '', confirm: '' }); }}>Cancel</button>
            </div>
          </form>
        )}
      </div>

    </>
  );
}
