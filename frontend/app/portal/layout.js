'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth0 } from '@auth0/auth0-react';
import { fetchAPI } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import s from './layout.module.css';

// Breadcrumb group, page title and a one-line description for each portal page.
const PAGES = {
  '/portal': { title: 'Dashboard', description: 'Recent shipments, open quotes and spending at a glance.' },
  '/portal/quote': { group: 'Shipping', title: 'Get a quote', description: 'Compare carrier rates for a shipment and book the one you want.' },
  '/portal/shipments': { group: 'Shipping', title: 'Shipments', description: 'Every booking, its carrier and where it is now.' },
  '/portal/spot-rates': { group: 'Shipping', title: 'Spot-rate requests', description: 'Full truckload, air and ocean freight that IFF prices for you.' },
  '/portal/track': { group: 'Shipping', title: 'Track a shipment', description: 'Look up an IFF or carrier tracking number.' },
  '/portal/claims': { group: 'Shipping', title: 'Claims', description: 'Report loss, damage or delay and follow each claim.' },
  '/portal/billing': { group: 'Account', title: 'Billing', description: 'Payments, invoices, balances and statements.' },
  '/portal/profile': { group: 'Account', title: 'Profile', description: 'Your details, company and connected carrier accounts.' },
  '/portal/admin/spot-rates': { group: 'IFF operations', title: 'Spot rates', description: 'Price or decline customer requests for full truckload, air and ocean.' },
  '/portal/admin/guest-quotes': { group: 'IFF operations', title: 'Guest requests', description: 'Quote requests from visitors without an account.' },
  '/portal/admin/adjustments': { group: 'IFF operations', title: 'Adjustments', description: 'Carrier re-weighs and re-classes, and what customers owe or get back.' },
  '/portal/admin/accounts': { group: 'IFF operations', title: 'Accounts', description: 'Monthly-terms customers: credit limits, balances and statements.' },
  '/portal/admin/pricing': { group: 'IFF operations', title: 'Pricing', description: 'Markup rules, quote margins, corrections and receivables.' },
};

const SIDEBAR_KEY = 'iff.sidebarCollapsed';

export default function PortalLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Remember the collapsed sidebar per browser.
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(SIDEBAR_KEY) === '1'); } catch { /* storage unavailable */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed(c => {
      try { localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1'); } catch { /* storage unavailable */ }
      return !c;
    });
  }
  useEffect(() => { setNavOpen(false); }, [pathname]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      loginWithRedirect();
    }
  }, [isLoading, isAuthenticated, loginWithRedirect]);

  // Check if user needs onboarding (company setup)
  useEffect(() => {
    if (!isAuthenticated || isLoading) return;

    let cancelled = false;
    async function checkOnboarding() {
      try {
        const data = await fetchAPI('/api/profile/onboarding-status');
        if (cancelled) return;
        const needsFlow = data.needsOnboarding || data.needsTerms;
        if (needsFlow && pathname !== '/portal/onboarding') {
          router.replace('/portal/onboarding');
        } else if (!needsFlow && pathname === '/portal/onboarding') {
          router.replace('/portal');
        }
      } catch {
        // If the check fails, let them through (don't block on error)
      } finally {
        if (!cancelled) setOnboardingChecked(true);
      }
    }
    checkOnboarding();
    return () => { cancelled = true; };
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className={s.loading} role="status">Loading your portal…</div>
    );
  }

  // Show onboarding page without the portal chrome (sidebar/topbar)
  if (pathname === '/portal/onboarding') {
    return children;
  }

  if (!onboardingChecked) {
    return (
      <div className={s.loading} role="status">Loading your portal…</div>
    );
  }

  const page = PAGES[pathname] || { title: 'Portal' };

  return (
    <div className={`${s.wrapper} ${collapsed ? s.wrapperCollapsed : ''}`}>
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />
      <div className={s.main}>
        <Topbar title={page.title} group={page.group} onOpenNav={() => setNavOpen(true)} />
        <main className={s.pageContent}>
          <div className={s.pageHeader}>
            <h1 className={s.pageTitle}>{page.title}</h1>
            {page.description && <p className={s.pageDescription}>{page.description}</p>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
