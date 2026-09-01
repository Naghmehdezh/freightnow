'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth0 } from '@auth0/auth0-react';
import { fetchAPI } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import Topbar from '@/components/Topbar';
import s from './layout.module.css';

const PAGE_TITLES = {
  '/portal': 'Dashboard',
  '/portal/quote': 'Get a Quote',
  '/portal/shipments': 'My Shipments',
  '/portal/track': 'Track Shipment',
  '/portal/claims': 'Claims',
  '/portal/profile': 'Profile',
  '/portal/billing': 'Billing',
};

export default function PortalLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const [onboardingChecked, setOnboardingChecked] = useState(false);

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  // Show onboarding page without the portal chrome (sidebar/topbar)
  if (pathname === '/portal/onboarding') {
    return children;
  }

  if (!onboardingChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading...</p>
      </div>
    );
  }

  const title = PAGE_TITLES[pathname] || 'Portal';

  return (
    <div className={s.wrapper}>
      <Sidebar />
      <div className={s.main}>
        <Topbar title={title} />
        <div className={s.pageContent}>
          {children}
        </div>
      </div>
    </div>
  );
}
