'use client';
import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useRouter } from 'next/navigation';
import st from '../login/page.module.css';

export default function RegisterPage() {
  const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push('/portal');
    } else if (!isLoading && !isAuthenticated) {
      loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } });
    }
  }, [isLoading, isAuthenticated, loginWithRedirect, router]);

  return (
    <div className={st.screen} role="status">
      <img src="/logo.svg" alt="IFF Cargo" className={st.logo} />
      <p className={st.status}>Opening account sign-up…</p>
    </div>
  );
}
