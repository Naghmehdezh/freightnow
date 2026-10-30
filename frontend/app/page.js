'use client';
import { useState } from 'react';
import Link from 'next/link';
import s from './page.module.css';

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
      {/* NAV */}
      <nav className={s.nav}>
        <div className={s.navInner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <Link href="/" className={s.navLogo}><img src="/logo.svg" alt="IFF" style={{ height: '44px', width: 'auto' }} /></Link>
            <div className={s.navBrand}>International<br />Freight Forwarders</div>
          </div>
          <div className={s.navLinks}>
            <a href="#services">Services</a>
            <a href="#why">About</a>
            <a href="#portal">Ship Online</a>
            <a href="#contact">Contact</a>
          </div>
          <div className={s.navCta}>
            <Link href="/login" className={s.btnOutline}>Sign in</Link>
            <Link href="/register" className={s.btnPrimary}>Get a quote</Link>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className={s.hero}>
        <div className={s.heroInner}>
          <div>
            <div className={s.heroBadge}>Trusted Since 1993 &middot; Over 30 Years of Experience</div>
            <h1>Every Shipment.<br />Every <span>Destination.</span><br />Every Time.</h1>
            <p className={s.heroSub}>From a single envelope to full truckloads, IFF delivers end-to-end freight solutions across Canada, the US, and worldwide — with real-time rates and instant booking online.</p>
            <div className={s.heroActions}>
              <Link href="/register" className={s.btnHeroPrimary}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                Sign up to get instant quotes
              </Link>
              <a href="#services" className={s.btnHeroOutline}>Our services</a>
            </div>
            <p className={s.heroGuest}>No account? <Link href="/quote-request">Request a quote as a guest</Link> and our team will contact you.</p>
            <div className={s.heroStats}>
              <div><div className={s.statNum}>30+</div><div className={s.statLabel}>Years in business</div></div>
              <div><div className={s.statNum}>5+</div><div className={s.statLabel}>Carrier partners</div></div>
              <div><div className={s.statNum}>24/7</div><div className={s.statLabel}>Online booking</div></div>
            </div>
          </div>

          <div className={s.heroCard}>
            <div className={s.heroCardTitle}>Get an instant quote</div>
            <div className={s.heroCardSub}>Compare rates across all carriers in seconds</div>
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
              <div className={s.quickField}><label htmlFor="qc-weight">Weight per item (lbs)</label><input id="qc-weight" type="number" min="0" value={quick.weight} onChange={setQ('weight')} /></div>
              <div className={s.quickField}><label htmlFor="qc-date">Pickup date</label><input id="qc-date" type="date" value={quick.date} onChange={setQ('date')} /></div>
            </div>
            <Link href="/register" className={s.btnGetQuote}>Sign up for instant rates &rarr;</Link>
            <div className={s.cardNote}>Free account &middot; Instant rates from all carriers</div>
            <div className={s.orDivider}><span>or</span></div>
            <Link href={guestHref} className={s.btnGuest}>Continue as guest and get a quote from our team</Link>
            <div className={s.cardNote}>We&apos;ll contact you with a price. No account needed.</div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section className={`${s.section} ${s.services}`} id="services">
        <div className={s.container}>
          <div className={s.sectionTag}>What we offer</div>
          <h2 className={s.sectionTitle}>Complete shipping solutions for every need</h2>
          <p className={s.sectionSub}>Whether you need to send a document across town or a full container across the ocean, IFF has the solution — and the experience to back it up.</p>
          <div className={s.servicesGrid}>
            <div className={s.serviceCard}>
              <div className={s.serviceIcon}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="m2 6 10 8 10-8"/></svg></div>
              <h3>Courier &amp; Small Packages</h3>
              <p>Door-to-door courier service for envelopes, documents, and small packages across Canada and the US.</p>
              <span className={`${s.serviceTag} ${s.serviceTagInstant}`}>&#9889; Instant quotes available</span>
            </div>
            <div className={s.serviceCard}>
              <div className={s.serviceIcon}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></div>
              <h3>LTL &amp; FTL Trucking</h3>
              <p>Less-than-truckload and full truckload freight across Canada and the US from our network of top-tier carriers.</p>
              <span className={`${s.serviceTag} ${s.serviceTagInstant}`}>&#9889; Instant quotes available</span>
            </div>
            <div className={s.serviceCard}>
              <div className={s.serviceIcon}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>
              <h3>Air Freight</h3>
              <p>Import and export air freight solutions for time-sensitive cargo. International and domestic routes.</p>
              <span className={s.serviceTag}>Request spot rate</span>
            </div>
            <div className={s.serviceCard}>
              <div className={s.serviceIcon}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 17l4-8 4 4 4-6 4 10"/><path d="M3 21h18"/></svg></div>
              <h3>Ocean Freight</h3>
              <p>LCL and FCL ocean freight between Canada and the US. Cost-effective container solutions for your cargo.</p>
              <span className={s.serviceTag}>Request spot rate</span>
            </div>
            <div className={s.serviceCard}>
              <div className={s.serviceIcon}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>
              <h3>Customs Clearance</h3>
              <p>Expert customs brokerage for import and export shipments. We handle all documentation and compliance.</p>
              <span className={s.serviceTag}>Request spot rate</span>
            </div>
            <div className={s.serviceCard}>
              <div className={s.serviceIcon}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
              <h3>Declared Value &amp; Drayage</h3>
              <p>Declared value coverage for your shipments plus drayage services for port and rail container pickup and delivery.</p>
              <span className={s.serviceTag}>Request spot rate</span>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className={s.footer}>
        <div className={s.container}>
          <div className={s.footerGrid}>
            <div className={s.footerBrand}>
              <img src="/logo-white.svg" alt="IFF" />
              <p>Your trusted freight partner since 1993. Shipping solutions for every need — from envelopes to ocean containers.</p>
            </div>
            <div className={s.footerCol}>
              <h4>Services</h4>
              <a href="#services">Courier &amp; Parcels</a>
              <a href="#services">LTL &amp; FTL Freight</a>
              <a href="#services">Air Freight</a>
              <a href="#services">Ocean Freight</a>
              <a href="#services">Customs Clearance</a>
            </div>
            <div className={s.footerCol}>
              <h4>Company</h4>
              <a href="#why">About IFF</a>
              <a href="#contact">Contact</a>
              <a href="#portal">Ship Online</a>
            </div>
            <div className={s.footerCol}>
              <h4>Contact</h4>
              <a href="tel:4167984151">416 798 4151</a>
              <a href="mailto:info@iffcargo.com">info@iffcargo.com</a>
              <a href="#">286 Attwell Drive, Unit 16<br />Toronto, ON M9W 5B2</a>
            </div>
          </div>
          <div className={s.footerBottom}>
            <span>&copy; 2026 International Freight Forwarders. All rights reserved.</span>
            <span>Trusted since 1993</span>
          </div>
        </div>
      </footer>
    </>
  );
}
