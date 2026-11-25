'use client';
import { useState } from 'react';
import Link from 'next/link';
import s from './page.module.css';
import { FEDEX_DISCLAIMER } from '@/lib/fedexCompliance';

const QUICK_TYPES = [
  { value: 'envelope', label: 'Envelope' },
  { value: 'parcel', label: 'Parcel' },
  { value: 'freight', label: 'Freight' },
];

export default function HomePage() {
  // Quote card: signing up gives instant rates; "continue as guest" sends what was typed to the
  // guest request form so IFF staff can contact the visitor with a price.
  const [quick, setQuick] = useState({ type: 'envelope', from: '', to: '', weight: '', date: '' });
  const setQ = field => e => setQuick(q => ({ ...q, [field]: e.target.value }));
  const guestHref = `/quote-request?${new URLSearchParams(Object.entries(quick).filter(([, v]) => v)).toString()}`;

  return (
    <>
      <header className={s.nav}>
        <div className={s.navInner}>
          <Link href="/" className={s.navLogo} aria-label="IFF Cargo home"><img src="/logo.svg" alt="IFF Cargo" /></Link>
          <nav className={s.navLinks} aria-label="Site">
            <a href="#services">Services</a>
            <a href="#contact">Contact</a>
          </nav>
          <div className={s.navCta}>
            <Link href="/login" className={s.btnOutline}>Sign in</Link>
          </div>
        </div>
      </header>

      <main>
        <section className={s.hero}>
          <div className={s.heroInner}>
            <div className={s.heroCopy}>
              <p className={s.heroKicker}>International Freight Forwarders, Toronto</p>
              <h1>Compare carrier rates and book freight in one place.</h1>
              <p className={s.heroSub}>Quote, book and track shipments with carriers across Canada and the US from one account.</p>
              <dl className={s.stats}>
                <div><dt>Years in business</dt><dd>30+</dd></div>
                <div><dt>Carrier partners</dt><dd>5+</dd></div>
                <div><dt>Online booking</dt><dd>24/7</dd></div>
              </dl>
            </div>

            <div className={s.heroCard}>
              <h2 className={s.heroCardTitle}>Get a quote</h2>
              <div className={s.heroCardSub}>Tell us what you&apos;re shipping.</div>
              <div className={s.quickTypeTabs} role="radiogroup" aria-label="Shipment type">
                {QUICK_TYPES.map(t => (
                  <button key={t.value} type="button" role="radio" aria-checked={quick.type === t.value}
                    className={`${s.qtTab} ${quick.type === t.value ? s.qtTabActive : ''}`}
                    onClick={() => setQuick(q => ({ ...q, type: t.value }))}>{t.label}</button>
                ))}
              </div>
              <div className={s.quickGrid}>
                <div className={s.quickField}><label htmlFor="qc-from">From</label><input id="qc-from" placeholder="City or postal code" value={quick.from} onChange={setQ('from')} /></div>
                <div className={s.quickField}><label htmlFor="qc-to">To</label><input id="qc-to" placeholder="City or postal code" value={quick.to} onChange={setQ('to')} /></div>
              </div>
              <div className={s.quickGrid}>
                <div className={s.quickField}><label htmlFor="qc-weight">Weight per item (lb)</label><input id="qc-weight" type="number" min="0" value={quick.weight} onChange={setQ('weight')} /></div>
                <div className={s.quickField}><label htmlFor="qc-date">Pickup date</label><input id="qc-date" type="date" value={quick.date} onChange={setQ('date')} /></div>
              </div>
              <Link href="/register" className={s.btnGetQuote}>Sign up for instant rates</Link>
              <div className={s.orDivider}><span>or</span></div>
              <Link href={guestHref} className={s.btnGuest}>Continue as guest and get a quote from our team</Link>
              <div className={s.cardNote}>We&apos;ll contact you with a price. No account needed.</div>
            </div>
          </div>
        </section>

        <section className={s.section} id="services">
          <div className={s.container}>
            <div className={s.sectionHead}>
              <h2 className={s.sectionTitle}>Services</h2>
              
            </div>
            <div className={s.servicesTable} role="table" aria-label="Services">
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>Courier and small packages</h3></div>
                <p role="cell">Envelopes and packages, door to door.</p>
                <span role="cell" className={`${s.serviceTag} ${s.serviceTagInstant}`}>Instant carrier rates</span>
              </div>
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>LTL freight</h3></div>
                <p role="cell">Pallets that share a truck.</p>
                <span role="cell" className={`${s.serviceTag} ${s.serviceTagInstant}`}>Instant carrier rates</span>
              </div>
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>Full and partial truckload</h3></div>
                <p role="cell">A dedicated truck for larger loads.</p>
                <span role="cell" className={s.serviceTag}>Priced by IFF</span>
              </div>
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>Air freight</h3></div>
                <p role="cell">Time-sensitive cargo, import and export.</p>
                <span role="cell" className={s.serviceTag}>Priced by IFF</span>
              </div>
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>Ocean freight</h3></div>
                <p role="cell">LCL and FCL containers.</p>
                <span role="cell" className={s.serviceTag}>Priced by IFF</span>
              </div>
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>Customs clearance</h3></div>
                <p role="cell">Brokerage, documents and compliance.</p>
                <span role="cell" className={s.serviceTag}>Priced by IFF</span>
              </div>
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>Shipment protection (declared value)</h3></div>
                <p role="cell">Cover your goods' value if they're lost or damaged.</p>
                <span role="cell" className={`${s.serviceTag} ${s.serviceTagInstant}`}>Instant carrier rates</span>
              </div>
              <div className={s.serviceRow} role="row">
                <div role="cell"><h3>Container drayage</h3></div>
                <p role="cell">Containers between port or rail yard and your door.</p>
                <span role="cell" className={s.serviceTag}>Priced by IFF</span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className={s.footer} id="contact">
        <div className={s.container}>
          <div className={s.footerGrid}>
            <div className={s.footerBrand}>
              <img src="/logo-white.svg" alt="IFF Cargo" />
            </div>
            <div className={s.footerCol}>
              <h4>Contact</h4>
              <a href="tel:4167984151">416 798 4151</a>
              <a href="mailto:info@iffcargo.com">info@iffcargo.com</a>
              <address>286 Attwell Drive, Unit 16<br />Toronto, ON M9W 5B2</address>
            </div>
          </div>
          <div className={s.footerBottom}>
            <span>&copy; 2026 International Freight Forwarders. All rights reserved.</span>
            <span>{FEDEX_DISCLAIMER}</span>
          </div>
        </div>
      </footer>
    </>
  );
}
