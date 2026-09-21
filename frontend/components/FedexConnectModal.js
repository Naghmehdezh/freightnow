'use client';
import { useState, useRef } from 'react';
import { fetchAPI } from '@/lib/api';
import { FEDEX_DISCLAIMER, FEDEX_EULA_TEXT } from '@/lib/fedexCompliance';
import CarrierLogo from './CarrierLogo';
import s from './FedexConnectModal.module.css';

const ALL_FACTOR2_METHODS = [
  { id: 'pin_email', fedexOption: 'EMAIL', label: 'Email me a 6-digit code' },
  { id: 'pin_sms', fedexOption: 'SMS', label: 'Text me a 6-digit code (SMS)' },
  { id: 'pin_call', fedexOption: 'CALL', label: 'Call me with a 6-digit code' },
  { id: 'invoice', fedexOption: null, label: 'Validate with a recent FedEx invoice' },
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

  const eulaBoxRef = useRef(null);

  function handleEulaScroll() {
    const el = eulaBoxRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setScrolledToEnd(true);
  }

  async function handleAcceptEula() {
    setStep('factor1');
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
          <CarrierLogo id="fedex" label="FedEx" className={s.brandMark} style={{ height: 22, width: 'auto', objectFit: 'contain' }} fallbackStyle={{ fontSize: 16, color: 'var(--navy)' }} />
          <div className={s.title}>Activate FedEx Shipping</div>
        </div>

        {step === 'eula' && (
          <>
            <div className={s.stepLabel}>Step 1 of 4 — FedEx End User License Agreement</div>
            <p className={s.hint}>
              FedEx requires all users shipping through FedEx services to review and accept the FedEx
              End User License Agreement before creating their first shipment.
            </p>
            <div ref={eulaBoxRef} onScroll={handleEulaScroll} className={s.eulaBox}>
              {FEDEX_EULA_TEXT}
            </div>
            <label className={s.checkboxRow}>
              <input type="checkbox" disabled={!scrolledToEnd} checked={eulaChecked} onChange={e => setEulaChecked(e.target.checked)} />
              I have read and understand the FedEx EULA{!scrolledToEnd && ' (scroll to the end to continue)'}
            </label>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnCancel} onClick={onClose}>Cancel</button>
              <button type="button" className={s.btnPrimary} disabled={!eulaChecked} onClick={handleAcceptEula}>
                I accept the terms of FedEx EULA to start shipping
              </button>
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
            <div className="field"><label>Street address</label><input value={address.street} onChange={e => setAddress({ ...address, street: e.target.value })} required /></div>
            <div className="grid2">
              <div className="field"><label>City</label><input value={address.city} onChange={e => setAddress({ ...address, city: e.target.value })} required /></div>
              <div className="field"><label>Province / State</label><input value={address.province} onChange={e => setAddress({ ...address, province: e.target.value })} /></div>
            </div>
            <div className="grid2">
              <div className="field"><label>Postal code</label><input value={address.postalCode} onChange={e => setAddress({ ...address, postalCode: e.target.value })} required /></div>
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
            {ALL_FACTOR2_METHODS
              .filter(m => {
                // Always show invoice; show PIN methods only if FedEx says they're available
                if (m.id === 'invoice') return true;
                const opts = connection?.availablePinDeliveryOptions;
                return !opts || !opts.length || opts.includes(m.fedexOption);
              })
              .map(m => (
              <label key={m.id} className={s.radioRow}>
                <input type="radio" name="factor2" value={m.id} checked={method === m.id} onChange={() => setMethod(m.id)} />
                {m.label}
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
            <p className={s.hint}>Enter the 6-digit secure code sent to you by FedEx.</p>
            {error && <div className={s.error}>{error}</div>}
            <div className="field">
              <label>6-digit secure code</label>
              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} pattern="\d{6}" maxLength={6} required autoFocus />
            </div>
            <button type="button" className={s.linkBtn} onClick={handleResendCode} disabled={loading}>Resend code</button>
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
            <p className={s.hint}>Enter the details of a FedEx invoice issued in the last 90 days.</p>
            {error && <div className={s.error}>{error}</div>}
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

        {step === 'locked' && (
          <>
            <div className={s.stepLabel}>Account addition</div>
            <div className={s.error}>We are unable to process this request. Please try again later or contact FedEx Customer Service and ask for technical support.</div>
            <div className={s.disclaimer}>{FEDEX_DISCLAIMER}</div>
            <div className={s.actions}>
              <button type="button" className={s.btnPrimary} onClick={onClose}>Close</button>
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
