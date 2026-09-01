'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAPI } from '@/lib/api';
import { FEDEX_EULA_TEXT } from '@/lib/fedexCompliance';
import s from './page.module.css';

const IFF_TERMS = `IFF CARGO TERMS OF SERVICE

By using the IFF Cargo platform, you agree to the following terms:

1. Service description. IFF Cargo provides an online platform for comparing and booking freight shipping services from multiple carriers. All rates shown are estimates and may be subject to adjustment based on actual shipment weight, dimensions, and carrier surcharges.

2. Account responsibility. You are responsible for maintaining the confidentiality of your account credentials. You confirm that you are authorised to ship on behalf of the company associated with your account.

3. Payment. For card-paying customers, payment is collected at the time of booking. For customers on monthly terms, invoices are due within 30 days of issue. Late payments may incur interest charges.

4. Shipment accuracy. You are responsible for providing accurate shipment details including weight, dimensions, origin, and destination. Inaccurate information may result in additional charges from the carrier.

5. Claims. Cargo claims must be filed within 60 days of delivery (or expected delivery date for lost shipments). IFF Cargo will assist in filing claims with carriers but does not guarantee claim outcomes.

6. Limitation of liability. IFF Cargo acts as an intermediary between you and the carriers. Liability for loss or damage is governed by each carrier's terms of carriage.

7. Privacy. Your personal and company information is used solely for the purpose of providing shipping services. We do not sell or share your data with third parties unrelated to shipping.

8. Termination. Either party may terminate this agreement at any time. Outstanding invoices remain due upon termination.`;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [personal, setPersonal] = useState({ firstName: '', lastName: '' });
  const [form, setForm] = useState({
    name: '', street: '', city: '', province: '', postalCode: '', country: 'CA', phone: '', taxNumber: '',
  });
  const [termsChecked, setTermsChecked] = useState(false);
  const [fedexChecked, setFedexChecked] = useState(false);
  const [authorizedChecked, setAuthorizedChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // If user already has a company but hasn't accepted terms, skip to step 2
  useEffect(() => {
    async function check() {
      try {
        const data = await fetchAPI('/api/profile/onboarding-status');
        if (!data.needsOnboarding && data.needsTerms) {
          setStep(2);
        }
      } catch { /* ignore */ }
    }
    check();
  }, []);

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleCompanySubmit(e) {
    e.preventDefault();
    setError('');
    if (!personal.firstName.trim() || !personal.lastName.trim()) { setError('First and last name are required'); return; }
    if (!form.name.trim()) { setError('Company name is required'); return; }
    if (!form.country.trim()) { setError('Country is required'); return; }

    setLoading(true);
    try {
      await fetchAPI('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(personal),
      });
      await fetchAPI('/api/profile/company', {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      setStep(2);
    } catch (err) {
      setError(err.error?.message || err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleTermsSubmit(e) {
    e.preventDefault();
    setError('');
    if (!termsChecked || !fedexChecked || !authorizedChecked) {
      setError('You must accept all agreements to continue');
      return;
    }

    setLoading(true);
    try {
      await fetchAPI('/api/profile/accept-terms', { method: 'POST' });
      router.push('/portal');
    } catch (err) {
      setError(err.error?.message || err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={s.wrapper}>
      <div className={s.card}>
        <div className={s.logo}>IFF <span>Cargo</span></div>

        {/* Step indicator */}
        <div className={s.steps}>
          <div className={`${s.stepDot} ${step >= 1 ? s.active : ''}`}>1</div>
          <div className={s.stepLine} />
          <div className={`${s.stepDot} ${step >= 2 ? s.active : ''}`}>2</div>
        </div>

        {step === 1 && (
          <>
            <h1 className={s.title}>Set up your account</h1>
            <p className={s.subtitle}>
              Tell us about yourself and your company. Every user on IFF Cargo ships on behalf of a company — this lets your team share payment methods and shipping history.
            </p>

            {error && <div className={s.error}>{error}</div>}

            <form onSubmit={handleCompanySubmit} className={s.form}>
              <div className={s.row}>
                <label className={s.label}>
                  First name <span className={s.req}>*</span>
                  <input className={s.input} value={personal.firstName} onChange={e => setPersonal(p => ({ ...p, firstName: e.target.value }))} required />
                </label>
                <label className={s.label}>
                  Last name <span className={s.req}>*</span>
                  <input className={s.input} value={personal.lastName} onChange={e => setPersonal(p => ({ ...p, lastName: e.target.value }))} required />
                </label>
              </div>

              <div className={s.divider} />

              <label className={s.label}>
                Company name <span className={s.req}>*</span>
                <input className={s.input} value={form.name} onChange={e => update('name', e.target.value)} required />
              </label>

              <label className={s.label}>
                Street address
                <input className={s.input} value={form.street} onChange={e => update('street', e.target.value)} placeholder="123 Main St, Unit 4" />
              </label>

              <div className={s.row}>
                <label className={s.label}>
                  City
                  <input className={s.input} value={form.city} onChange={e => update('city', e.target.value)} />
                </label>
                <label className={s.label}>
                  Province / State
                  <input className={s.input} value={form.province} onChange={e => update('province', e.target.value)} />
                </label>
              </div>

              <div className={s.row}>
                <label className={s.label}>
                  Postal code
                  <input className={s.input} value={form.postalCode} onChange={e => update('postalCode', e.target.value)} />
                </label>
                <label className={s.label}>
                  Country <span className={s.req}>*</span>
                  <select className={s.input} value={form.country} onChange={e => update('country', e.target.value)} required>
                    <option value="CA">Canada</option>
                    <option value="US">United States</option>
                  </select>
                </label>
              </div>

              <label className={s.label}>
                Phone
                <input className={s.input} value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="416 555 0100" />
              </label>

              <label className={s.label}>
                Tax number <span className={s.opt}>(GST/HST — optional)</span>
                <input className={s.input} value={form.taxNumber} onChange={e => update('taxNumber', e.target.value)} placeholder="123456789RT0001" />
              </label>

              <button type="submit" className={s.submit} disabled={loading}>
                {loading ? 'Saving…' : 'Continue to agreements'}
              </button>
            </form>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className={s.title}>Agreements</h1>
            <p className={s.subtitle}>
              Please review and accept the following terms before using IFF Cargo. These are required by our carrier partners.
            </p>

            {error && <div className={s.error}>{error}</div>}

            <form onSubmit={handleTermsSubmit} className={s.form}>
              <div className={s.termsSection}>
                <div className={s.termsLabel}>IFF Cargo Terms of Service</div>
                <div className={s.termsBox}>{IFF_TERMS}</div>
                <label className={s.checkbox}>
                  <input type="checkbox" checked={termsChecked} onChange={e => setTermsChecked(e.target.checked)} />
                  <span>I have read and accept the IFF Cargo Terms of Service</span>
                </label>
              </div>

              <div className={s.termsSection}>
                <div className={s.termsLabel}>FedEx End User License Agreement</div>
                <div className={s.termsBox}>{FEDEX_EULA_TEXT}</div>
                <label className={s.checkbox}>
                  <input type="checkbox" checked={fedexChecked} onChange={e => setFedexChecked(e.target.checked)} />
                  <span>I have read and accept the FedEx End User License Agreement</span>
                </label>
              </div>

              <div className={s.termsSection}>
                <label className={s.checkbox}>
                  <input type="checkbox" checked={authorizedChecked} onChange={e => setAuthorizedChecked(e.target.checked)} />
                  <span>I confirm that I am authorised to open and manage a shipping account on behalf of my company</span>
                </label>
              </div>

              <button type="submit" className={s.submit} disabled={loading || !termsChecked || !fedexChecked || !authorizedChecked}>
                {loading ? 'Completing…' : 'Accept & continue to dashboard'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
