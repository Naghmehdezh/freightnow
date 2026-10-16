'use client';
import { useState } from 'react';
import { fetchAPI } from '@/lib/api';
import {
  FEDEX_DISCLAIMER, FEDEX_EULA_REVISION, FEDEX_EULA_CHECKBOX_LABEL, FEDEX_EULA_ACCEPT_BUTTON,
  FEDEX_VALIDATION_FAILED_MESSAGE,
} from '@/lib/fedexCompliance';
import FedexEulaViewer from './FedexEulaViewer';
import CarrierLogo from './CarrierLogo';
import s from './FedexConnectModal.module.css';

const ALL_FACTOR2_METHODS = [
  { id: 'pin_email', fedexOption: 'EMAIL', label: 'Email me a 6-digit code' },
  { id: 'pin_sms', fedexOption: 'SMS', label: 'Text me a 6-digit code (SMS)' },
  { id: 'pin_call', fedexOption: 'CALL', label: 'Call me with a 6-digit code' },
  { id: 'invoice', fedexOption: null, label: 'Validate with a recent FedEx invoice' },
  // Fallback only (FedEx Integrator guidance §4): never offered up front — shown only after a
  // PIN/invoice attempt has failed.
  { id: 'support', fedexOption: null, label: 'Call FedEx Customer Service for technical support' },
];


export default function FedexConnectModal({ onClose, onConnected }) {
  const [step, setStep] = useState('eula');
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [eulaChecked, setEulaChecked] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [connection, setConnection] = useState(null);

  const [fedexAccountNumber, setFedexAccountNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [address, setAddress] = useState({ street: '', city: '', province: '', postalCode: '', country: 'CA' });

  const [method, setMethod] = useState('pin_email');
  const [code, setCode] = useState('');
  const [invoice, setInvoice] = useState({ invoiceNumber: '', invoiceDate: '', amount: '', currency: 'CAD' });

  const [eulaAcceptedAt, setEulaAcceptedAt] = useState(null);
  const [factor2Failed, setFactor2Failed] = useState(false); // unlocks the tech-support fallback

  async function handleAcceptEula() {
    setEulaAcceptedAt(new Date());
    setStep('eulaAccepted');
  }

  async function handleFactor1Submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await fetchAPI('/api/fedex-account', {
        method: 'POST',
        body: JSON.stringify({ fedexAccountNumber, customerName: customerName || undefined, address, eulaAccepted: true }),
      });
      setConnection(data.connection);
      // Customer Service bypass — FedEx returned credentials directly
      if (data.connection.status === 'verified') {
        setStep('success');
      } else {
        setStep('factor2choice');
      }
    } catch (err) {
      setError(err.error?.message || 'Could not start FedEx account connection.');
    } finally {
      setLoading(false);
    }
  }

  async function handleFactor2Choice(e) {
    e.preventDefault();
    setError('');
    if (method === 'support') { setStep('support'); return; }
    setLoading(true);
    try {
      const data = await fetchAPI(`/api/fedex-account/${connection.id}/factor2/start`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      });
      setConnection(data.connection);
      setStep(method === 'invoice' ? 'invoiceVerify' : 'pinVerify');
    } catch (err) {
      setError(err.error?.message || 'Could not start verification.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setError('');
    setLoading(true);
    try {
      const data = await fetchAPI(`/api/fedex-account/${connection.id}/factor2/start`, {
        method: 'POST',
        body: JSON.stringify({ method }),
      });
      setConnection(data.connection);
      setCode('');
      setError('A new code has been sent.');
    } catch (err) {
      setError(err.error?.message || 'Could not resend code.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyPin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await fetchAPI(`/api/fedex-account/${connection.id}/factor2/verify-pin`, {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setConnection(data.connection);
      setStep('success');
    } catch (err) {
      if (err.error?.details?.connection) setConnection(err.error.details.connection);
      setFactor2Failed(true);
      setError(err.error?.message || 'Verification failed.');
      if (err.error?.details?.connection?.status === 'locked') setStep('locked');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyInvoice(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await fetchAPI(`/api/fedex-account/${connection.id}/factor2/verify-invoice`, {
        method: 'POST',
        body: JSON.stringify({ ...invoice, amount: parseFloat(invoice.amount) }),
      });
      setConnection(data.connection);
      setStep('success');
    } catch (err) {
      if (err.error?.details?.connection) setConnection(err.error.details.connection);
      setFactor2Failed(true);
      setError(err.error?.message || 'Verification failed.');
      if (err.error?.details?.connection?.status === 'locked') setStep('locked');
    } finally {
      setLoading(false);
    }
  }

  function handleDone() {
    onConnected?.();
    onClose();
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.card} onClick={e => e.stopPropagation()}>
        <div className={s.header}>
          <CarrierLogo id="fedex" label="FedEx" className={s.brandMark} style={{ height: 34, width: 'auto', objectFit: 'contain' }} fallbackStyle={{ fontSize: 16, color: 'var(--navy)' }} />
          <div className={s.title}>Activate FedEx Shipping</div>
        </div>

        {step === 'eula' && (
          <>
            <div className={s.stepLabel}>Step 1 of 4 — FedEx End User License Agreement</div>
            <p className={s.hint}>
              FedEx requires all users shipping through FedEx services to review and accept the FedEx
              End User License Agreement before creating their first shipment. Please scroll to the end of the last page.
            </p>
            <FedexEulaViewer onReachedEnd={() => setScrolledToEnd(true)} height={340} />
            <label className={`${s.checkboxRow} ${!scrolledToEnd ? s.checkboxDisabled : ''}`}>
              <input type="checkbox" disabled={!scrolledToEnd} checked={eulaChecked} onChange={e => setEulaChecked(e.target.checked)} />
              {FEDEX_EULA_CHECKBOX_LABEL}
            </label>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Cancel</button>
              <button type="button" className={s.btnPrimary} disabled={!scrolledToEnd || !eulaChecked} onClick={handleAcceptEula}>
                {FEDEX_EULA_ACCEPT_BUTTON}
              </button>
            </div>
          </>
        )}

        {step === 'eulaAccepted' && (
          <>
            <div className={s.stepLabel}>FedEx End User License Agreement</div>
            <div className={s.success}>
              You have accepted and agreed to the FedEx End User License Agreement.
            </div>
            <p className={s.hint}>
              {FEDEX_EULA_REVISION} — accepted {eulaAcceptedAt?.toLocaleString('en-CA', { dateStyle: 'long', timeStyle: 'short' })}.
            </p>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Close</button>
              <button type="button" className={s.btnPrimary} onClick={() => setStep('factor1')}>Continue</button>
            </div>
          </>
        )}

        {step === 'factor1' && (
          <form onSubmit={handleFactor1Submit}>
            <div className={s.stepLabel}>Step 2 of 4 — Shipper information</div>
            {error && <div className={s.error}>{error}</div>}
            <div className="field">
              <label>FedEx account number (9 digits)</label>
              <input value={fedexAccountNumber} onChange={e => setFedexAccountNumber(e.target.value)} pattern="\d{9}" maxLength={9} required />
            </div>
            <div className="field"><label>Customer name</label><input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Company or contact name" /></div>
            <p className={s.hint}>Enter the billing address exactly as it appears on your FedEx invoice.</p>
            <div className="field"><label>Street address</label><input value={address.street} onChange={e => setAddress({ ...address, street: e.target.value })} placeholder="e.g. 15 W 18TH ST FL 7" required /></div>
            <div className="grid2">
              <div className="field"><label>City</label><input value={address.city} onChange={e => setAddress({ ...address, city: e.target.value })} required /></div>
              <div className="field"><label>Province / State</label><input value={address.province} onChange={e => setAddress({ ...address, province: e.target.value })} /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>{address.country === 'US' ? 'ZIP+4' : 'Postal code'}</label><input value={address.postalCode} onChange={e => setAddress({ ...address, postalCode: e.target.value })} placeholder={address.country === 'US' ? 'e.g. 10011-4624' : 'e.g. L4W 5K6'} required /></div>
              <div className="field">
                <label>Country</label>
                <select value={address.country} onChange={e => setAddress({ ...address, country: e.target.value })}>
                  <option value="CA">Canada</option><option value="US">United States</option>
                </select>
              </div>
            </div>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Cancel</button>
              <button type="submit" className={s.btnPrimary} disabled={loading}>{loading ? 'Please wait…' : 'Next'}</button>
            </div>
          </form>
        )}

        {step === 'factor2choice' && (
          <form onSubmit={handleFactor2Choice}>
            <div className={s.stepLabel}>Step 3 of 4 — Choose how to confirm your identity</div>
            {error && <div className={s.error}>{error}</div>}
            <p className={s.hint}>FedEx will confirm that you own account {connection?.fedexAccountNumber}.</p>
            {ALL_FACTOR2_METHODS
              .filter(m => {
                // Offer only the methods FedEx returned for this account at Factor 1.
                if (m.id === 'support') return factor2Failed; // fallback only after a failed attempt
                if (m.id === 'invoice') return connection?.invoiceOptionAvailable !== false;
                const opts = connection?.availablePinDeliveryOptions;
                return !opts || !opts.length || opts.includes(m.fedexOption);
              })
              .map(m => (
              <label key={m.id} className={s.radioRow}>
                <input type="radio" name="factor2" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
                {m.label}
                {(m.id === 'pin_sms' || m.id === 'pin_call') && connection?.maskedPhoneNumber && ` — ${connection.maskedPhoneNumber}`}
              </label>
            ))}
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Cancel</button>
              <button type="submit" className={s.btnPrimary} disabled={loading}>{loading ? 'Please wait…' : 'Next'}</button>
            </div>
          </form>
        )}

        {step === 'pinVerify' && (
          <form onSubmit={handleVerifyPin}>
            <div className={s.stepLabel}>Step 4 of 4 — Secure code validation</div>
            <p className={s.hint}>Enter the 6-digit secure code FedEx sent you{method === 'pin_email' ? ' by email' : method === 'pin_sms' ? ' by text message' : ' by phone call'}.</p>
            {error && <div className={s.error}>{error}</div>}
            <div className="field">
              <label>6-digit secure code</label>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} pattern="\d{6}" maxLength={6} required autoFocus />
            </div>
            <div className={s.linkRow}>
              <button type="button" className={s.linkBtn} onClick={handleResendCode} disabled={loading}>Resend code</button>
              {factor2Failed && <button type="button" className={s.linkBtn} onClick={() => { setError(''); setStep('factor2choice'); }}>Choose another method</button>}
            </div>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Cancel</button>
              <button type="submit" className={s.btnPrimary} disabled={loading || code.length !== 6}>{loading ? 'Verifying…' : 'Verify'}</button>
            </div>
          </form>
        )}

        {step === 'invoiceVerify' && (
          <form onSubmit={handleVerifyInvoice}>
            <div className={s.stepLabel}>Step 4 of 4 — Invoice validation</div>
            <p className={s.hint}>Enter the details of a FedEx invoice for this account from the last 90 days.</p>
            {error && <div className={s.error}>{error}</div>}
            {factor2Failed && <button type="button" className={s.linkBtn} onClick={() => { setError(''); setStep('factor2choice'); }}>Choose another method</button>}
            <div className="field"><label>Invoice number</label><input value={invoice.invoiceNumber} onChange={e => setInvoice({ ...invoice, invoiceNumber: e.target.value })} required /></div>
            <div className="grid2">
              <div className="field"><label>Invoice date</label><input type="date" value={invoice.invoiceDate} onChange={e => setInvoice({ ...invoice, invoiceDate: e.target.value })} required /></div>
              <div className="field"><label>Invoice amount</label><input type="number" step="0.01" min="0.01" value={invoice.amount} onChange={e => setInvoice({ ...invoice, amount: e.target.value })} required /></div>
            </div>
            <div className="field">
              <label>Currency</label>
              <select value={invoice.currency} onChange={e => setInvoice({ ...invoice, currency: e.target.value })}>
                <option value="CAD">CAD</option><option value="USD">USD</option>
              </select>
            </div>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Cancel</button>
              <button type="submit" className={s.btnPrimary} disabled={loading}>{loading ? 'Verifying…' : 'Verify'}</button>
            </div>
          </form>
        )}

        {step === 'support' && (
          <>
            <div className={s.stepLabel}>Fallback option: validation via FedEx technical support</div>
            <div className={s.error}>{FEDEX_VALIDATION_FAILED_MESSAGE}</div>
            <p className={s.hint}>
              Once FedEx technical support has verified your identity, select <b>Start again</b> and re-enter your
              FedEx account number and shipping address. FedEx will then complete the connection without another code.
            </p>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Close</button>
              <button type="button" className={s.btnPrimary} onClick={() => { setError(''); setFactor2Failed(false); setStep('factor1'); }}>Start again</button>
            </div>
          </>
        )}

        {step === 'locked' && (
          <>
            <div className={s.stepLabel}>Account addition</div>
            <div className={s.error}>{FEDEX_VALIDATION_FAILED_MESSAGE}</div>
            <p className={s.hint}>
              After FedEx technical support has verified your identity, select <b>Start again</b> and re-enter your
              FedEx account number and shipping address.
            </p>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Close</button>
              <button type="button" className={s.btnPrimary} onClick={() => { setError(''); setFactor2Failed(false); setStep('factor1'); }}>Start again</button>
            </div>
          </>
        )}

        {step === 'success' && (
          <>
            <div className={s.stepLabel}>Account addition</div>
            <div className={s.success}>FedEx Shipping is now active.</div>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnPrimary} onClick={handleDone}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
