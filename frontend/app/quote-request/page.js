'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { API_URL } from '@/lib/api';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import s from './page.module.css';

// "Continue as guest" — a quote request for visitors without an account. IFF staff receive it,
// contact the customer and price the shipment by hand. Signed-up customers get instant rates.

const TERMS = [
  { value: 'unknown', label: "Don't know" },
  { value: 'exw', label: 'Ex Works' },
  { value: 'fob', label: 'FOB' },
  { value: 'cif', label: 'CIF' },
  { value: 'cfr', label: 'C & F' },
  { value: 'dap', label: 'DAP' },
  { value: 'ddp', label: 'DDP' },
  { value: 'other', label: 'Other' },
];
const VOLUMES = {
  ocean: {
    help: "Choose full container load to ask about the price of an entire container, or loose container load if your shipment isn't large enough to fill a container.",
    options: [{ value: 'lcl', label: 'Loose Container Load' }, { value: 'fcl', label: 'Full Container Load' }],
  },
  land: {
    help: 'Choose full truckload for a whole truck, or less than truckload if your shipment shares a truck with other freight.',
    options: [{ value: 'ltl', label: 'Less Than Truckload' }, { value: 'ftl', label: 'Full Truckload' }],
  },
};
const emptyItem = () => ({ length: '', width: '', height: '', dimUnit: 'cm', weight: '', weightUnit: 'kg', quantity: '1' });
const emptyForm = () => ({
  name: '', company: '', email: '', phone: '',
  origin: '', originType: 'door', destination: '', destinationType: 'door',
  mode: '', volume: '', termsOfSale: 'unknown', hazardous: 'no', notes: '', website: '',
});

function Radio({ name, value, checked, onChange, children }) {
  return (
    <label className={s.radio}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

// Origin / destination: with "Door" the field searches Google addresses (picking one fills in
// the full address); typed text is kept as-is. With "Terminal / Port" it's a plain text field.
function EndField({ id, door, value, onChange }) {
  if (!door) return <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder="City, port or airport" />;
  return (
    <AddressAutocomplete
      bare
      publicAccess
      id={id}
      value={value}
      onChange={onChange}
      onSelect={address => onChange(address.formatted || [address.street, address.city, address.province, address.postalCode, address.country].filter(Boolean).join(', '))}
      placeholder="Start typing the address"
    />
  );
}

function QuoteRequestForm() {
  const params = useSearchParams();
  const [form, setForm] = useState(emptyForm);
  const [showItems, setShowItems] = useState(false);
  const [items, setItems] = useState([emptyItem()]);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null); // { requestNumber }
  const [serverError, setServerError] = useState('');

  // Carry over what the visitor typed in the home page quote card.
  useEffect(() => {
    const from = params.get('from'); const to = params.get('to');
    const weight = params.get('weight'); const type = params.get('type'); const date = params.get('date');
    setForm(f => ({
      ...f,
      ...(from && { origin: from }),
      ...(to && { destination: to }),
      ...(type === 'freight' && { mode: 'land' }),
      notes: [
        type && `Shipment type on the home page: ${type}`,
        date && `Pickup date: ${date}`,
      ].filter(Boolean).join('\n'),
    }));
    // The home card asks for the weight of one item: start the item list with it, and open the
    // details for parcels and freight so the visitor adds the size too.
    if (weight || type === 'parcel' || type === 'freight') {
      setItems([{ ...emptyItem(), ...(weight && { weight, weightUnit: 'lb', dimUnit: 'in' }) }]);
      setShowItems(true);
    }
  }, [params]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value, ...(field === 'mode' && { volume: '' }) }));
  const setItem = (i, field, value) => setItems(list => list.map((it, j) => (j === i ? { ...it, [field]: value } : it)));

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Enter your name';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) e.email = 'Enter a valid email';
    if (!/^[+\d\s().-]{7,20}$/.test(form.phone.trim())) e.phone = 'Enter a valid phone number';
    if (form.origin.trim().length < 2) e.origin = 'Enter the origin';
    if (form.destination.trim().length < 2) e.destination = 'Enter the destination';
    if (!form.mode) e.mode = 'Choose a shipping mode';
    if (VOLUMES[form.mode] && !form.volume) e.volume = 'Choose the shipping volume';
    if (showItems) {
      items.forEach((it, i) => {
        const ok = ['length', 'width', 'height', 'weight'].every(k => parseFloat(it[k]) > 0) && parseInt(it.quantity) > 0;
        if (!ok) e[`item${i}`] = 'Enter length, width, height, weight and number of items';
      });
    }
    setErrors(e);
    return !Object.keys(e).length;
  }

  async function submit(ev) {
    ev.preventDefault();
    setServerError('');
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/guest-quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          ...(form.company.trim() && { company: form.company.trim() }),
          email: form.email.trim(),
          phone: form.phone.trim(),
          origin: form.origin.trim(), originType: form.originType,
          destination: form.destination.trim(), destinationType: form.destinationType,
          mode: form.mode,
          ...(form.volume && { volume: form.volume }),
          ...(showItems && {
            items: items.map(it => ({
              length: parseFloat(it.length), width: parseFloat(it.width), height: parseFloat(it.height), dimUnit: it.dimUnit,
              weight: parseFloat(it.weight), weightUnit: it.weightUnit, quantity: parseInt(it.quantity),
            })),
          }),
          termsOfSale: form.termsOfSale,
          hazardous: form.hazardous === 'yes',
          ...(form.notes.trim() && { notes: form.notes.trim() }),
          source: params.get('from') || params.get('to') ? 'home' : 'direct',
          website: form.website,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.details?.[0]?.message || data?.error?.message || 'Your request could not be sent.');
      setDone({ requestNumber: data.requestNumber });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setServerError(`${err.message} You can also call us at 416 798 4151.`);
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setForm(emptyForm()); setItems([emptyItem()]); setShowItems(false); setErrors({}); setServerError('');
  }

  if (done) {
    return (
      <div className={s.card}>
        <div className={s.success}>
          <h2>Thank you, your request is in</h2>
          {done.requestNumber && <p>Your reference number is <b>{done.requestNumber}</b>.</p>}
          <p>An IFF representative will contact you shortly to confirm the details and give you a price. For an urgent shipment, call us at <b>416 798 4151</b>.</p>
          <p>Want instant rates next time? <Link href="/register">Create a free account</Link> to compare carriers and book online.</p>
          <div className={s.actions}><Link href="/" className={s.btnSecondary}>Back to home</Link></div>
        </div>
      </div>
    );
  }

  return (
    <form className={s.card} onSubmit={submit} noValidate>
      <h2 className={s.groupTitle}>Customer information</h2>
      <div className={s.grid2}>
        <div className={s.field}><label htmlFor="q-name">Name *</label><input id="q-name" value={form.name} onChange={set('name')} autoComplete="name" />{errors.name && <span className={s.err}>{errors.name}</span>}</div>
        <div className={s.field}><label htmlFor="q-company">Company</label><input id="q-company" value={form.company} onChange={set('company')} autoComplete="organization" /></div>
        <div className={s.field}><label htmlFor="q-email">Email *</label><input id="q-email" type="email" value={form.email} onChange={set('email')} autoComplete="email" />{errors.email && <span className={s.err}>{errors.email}</span>}</div>
        <div className={s.field}><label htmlFor="q-phone">Phone *</label><input id="q-phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" />{errors.phone && <span className={s.err}>{errors.phone}</span>}</div>
      </div>

      <h2 className={s.groupTitle}>Shipping information</h2>
      <div className={s.grid2}>
        <div className={s.field}>
          <label htmlFor="q-origin">Origin *</label>
          <EndField id="q-origin" door={form.originType === 'door'} value={form.origin} onChange={v => setForm(f => ({ ...f, origin: v }))} />
          <div className={s.radios}>
            <Radio name="originType" value="door" checked={form.originType === 'door'} onChange={set('originType')}>Door</Radio>
            <Radio name="originType" value="terminal" checked={form.originType === 'terminal'} onChange={set('originType')}>Terminal / Port</Radio>
          </div>
          {errors.origin && <span className={s.err}>{errors.origin}</span>}
        </div>
        <div className={s.field}>
          <label htmlFor="q-destination">Destination *</label>
          <EndField id="q-destination" door={form.destinationType === 'door'} value={form.destination} onChange={v => setForm(f => ({ ...f, destination: v }))} />
          <div className={s.radios}>
            <Radio name="destinationType" value="door" checked={form.destinationType === 'door'} onChange={set('destinationType')}>Door</Radio>
            <Radio name="destinationType" value="terminal" checked={form.destinationType === 'terminal'} onChange={set('destinationType')}>Terminal / Port</Radio>
          </div>
          {errors.destination && <span className={s.err}>{errors.destination}</span>}
        </div>
      </div>

      <fieldset className={s.fieldset}>
        <legend>Shipping mode *</legend>
        <div className={s.radios}>
          <Radio name="mode" value="air" checked={form.mode === 'air'} onChange={set('mode')}>Air</Radio>
          <Radio name="mode" value="ocean" checked={form.mode === 'ocean'} onChange={set('mode')}>Ocean</Radio>
          <Radio name="mode" value="land" checked={form.mode === 'land'} onChange={set('mode')}>Land</Radio>
        </div>
        {errors.mode && <span className={s.err}>{errors.mode}</span>}
      </fieldset>

      {VOLUMES[form.mode] && (
        <fieldset className={s.fieldset}>
          <legend>Shipping volume *</legend>
          <p className={s.help}>{VOLUMES[form.mode].help}</p>
          <div className={s.radios}>
            {VOLUMES[form.mode].options.map(o => (
              <Radio key={o.value} name="volume" value={o.value} checked={form.volume === o.value} onChange={set('volume')}>{o.label}</Radio>
            ))}
          </div>
          {errors.volume && <span className={s.err}>{errors.volume}</span>}
        </fieldset>
      )}

      <h2 className={s.groupTitle}>Shipment details <span>(optional)</span></h2>
      <p className={s.help}>You can send your request with just your contact details. To help us price it faster, add the size and weight of your items; otherwise a member of our team will ask you for them.</p>
      {!showItems ? (
        <button type="button" className={s.btnSecondary} onClick={() => setShowItems(true)}>Add shipment details</button>
      ) : (
        <>
          {items.map((it, i) => (
            <div key={i} className={s.item}>
              <div className={s.itemHead}>
                <b>Item {i + 1}</b>
                <button type="button" className={s.btnRemove} onClick={() => (items.length > 1 ? setItems(items.filter((_, j) => j !== i)) : setShowItems(false))}>Remove</button>
              </div>
              <div className={s.grid4}>
                <div className={s.field}><label htmlFor={`q-l-${i}`}>Length *</label><input id={`q-l-${i}`} type="number" min="0" step="any" value={it.length} onChange={e => setItem(i, 'length', e.target.value)} /></div>
                <div className={s.field}><label htmlFor={`q-w-${i}`}>Width *</label><input id={`q-w-${i}`} type="number" min="0" step="any" value={it.width} onChange={e => setItem(i, 'width', e.target.value)} /></div>
                <div className={s.field}><label htmlFor={`q-h-${i}`}>Height *</label><input id={`q-h-${i}`} type="number" min="0" step="any" value={it.height} onChange={e => setItem(i, 'height', e.target.value)} /></div>
                <div className={s.radiosInline}>
                  <Radio name={`dim-${i}`} value="cm" checked={it.dimUnit === 'cm'} onChange={() => setItem(i, 'dimUnit', 'cm')}>cm</Radio>
                  <Radio name={`dim-${i}`} value="in" checked={it.dimUnit === 'in'} onChange={() => setItem(i, 'dimUnit', 'in')}>inch</Radio>
                </div>
              </div>
              <div className={s.grid4}>
                <div className={s.field}>
                  <label htmlFor={`q-wt-${i}`}>Weight *</label>
                  <input id={`q-wt-${i}`} type="number" min="0" step="any" value={it.weight} onChange={e => setItem(i, 'weight', e.target.value)} />
                  <span className={s.hint}>Weight of one item.</span>
                </div>
                <div className={s.radiosInline}>
                  <Radio name={`wt-${i}`} value="kg" checked={it.weightUnit === 'kg'} onChange={() => setItem(i, 'weightUnit', 'kg')}>kg</Radio>
                  <Radio name={`wt-${i}`} value="lb" checked={it.weightUnit === 'lb'} onChange={() => setItem(i, 'weightUnit', 'lb')}>lbs</Radio>
                </div>
                <div className={s.field}>
                  <label htmlFor={`q-qty-${i}`}>No. of items *</label>
                  <input id={`q-qty-${i}`} type="number" min="1" step="1" value={it.quantity} onChange={e => setItem(i, 'quantity', e.target.value)} />
                </div>
              </div>
              <p className={s.hint}>If you have more than one item with the same dimensions and weight, change the number of items instead of adding a separate item.</p>
              {errors[`item${i}`] && <span className={s.err}>{errors[`item${i}`]}</span>}
            </div>
          ))}
          <div className={s.itemActions}>
            <button type="button" className={s.linkBtn} onClick={() => setItems([...items, emptyItem()])}>+ Add more items</button>
            <button type="button" className={s.linkBtn} onClick={() => { setShowItems(false); setItems([emptyItem()]); }}>Remove shipment details</button>
          </div>
        </>
      )}

      <h2 className={s.groupTitle}>Additional information <span>(optional)</span></h2>
      <div className={s.grid2}>
        <div className={s.field}>
          <label htmlFor="q-terms">Terms of sale</label>
          <select id="q-terms" value={form.termsOfSale} onChange={set('termsOfSale')}>
            {TERMS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <fieldset className={s.fieldset} style={{ margin: 0 }}>
          <legend>Is your item hazardous?</legend>
          <div className={s.radios}>
            <Radio name="hazardous" value="no" checked={form.hazardous === 'no'} onChange={set('hazardous')}>No</Radio>
            <Radio name="hazardous" value="yes" checked={form.hazardous === 'yes'} onChange={set('hazardous')}>Yes</Radio>
          </div>
        </fieldset>
      </div>
      <div className={s.field}>
        <label htmlFor="q-notes">Notes</label>
        <textarea id="q-notes" rows={3} value={form.notes} onChange={set('notes')} />
      </div>

      {/* Hidden from people; bots that fill it in are ignored. */}
      <div className={s.honeypot} aria-hidden="true">
        <label htmlFor="q-website">Website</label>
        <input id="q-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </div>

      {serverError && <div className={s.serverError}>{serverError}</div>}
      <div className={s.actions}>
        <button type="submit" className={s.btnPrimary} disabled={submitting}>{submitting ? 'Sending…' : 'Submit request'}</button>
        <button type="button" className={s.btnSecondary} onClick={reset}>Reset form</button>
      </div>
    </form>
  );
}

export default function QuoteRequestPage() {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/" className={s.logo}><img src="/logo.svg" alt="IFF" /></Link>
          <div className={s.headerLinks}>
            <Link href="/login" className={s.btnOutline}>Sign in</Link>
            <Link href="/register" className={s.btnAccent}>Sign up for instant rates</Link>
          </div>
        </div>
      </header>
      <main className={s.main}>
        <h1>Request a quote</h1>
        <p className={s.intro}>No account needed. Tell us about your shipment and an IFF representative will contact you shortly with a price. Required fields are marked with an asterisk (*).</p>
        <Suspense fallback={<div className={s.card}>Loading…</div>}>
          <QuoteRequestForm />
        </Suspense>
      </main>
    </div>
  );
}
