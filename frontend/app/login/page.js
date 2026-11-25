'use client';
import { Suspense, useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useRouter, useSearchParams } from 'next/navigation';
import st from './page.module.css';

// useSearchParams needs a Suspense boundary so the page can be prerendered.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginHandoff />
    </Suspense>
  );
}

function LoginHandoff() {
  const { loginWithRedirect, logout, isAuthenticated, isLoading, error } = useAuth0();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // Check URL params (Auth0 may redirect with ?error=access_denied)
    const urlError = searchParams.get('error');
    const urlErrorDesc = searchParams.get('error_description');
    if (urlError) {
      setAuthError(urlErrorDesc || 'Authentication failed. Please try again.');
      return;
    }

    // Check Auth0 SDK error (SDK processes the callback and exposes error here)
    if (error) {
      setAuthError(error.message || 'Authentication failed. Please try again.');
      return;
    }

    if (!isLoading && isAuthenticated) {
      router.push('/portal');
    } else if (!isLoading && !isAuthenticated) {
      loginWithRedirect();
    }
  }, [isLoading, isAuthenticated, error, loginWithRedirect, router, searchParams]);

  if (authError) {
    return (
      <div className={st.screen}>
        <img src="/logo.svg" alt="IFF Cargo" className={st.logo} />
        <div className={st.panel} role="alert">
          <h1 className={st.title}>Verify your email to sign in</h1>
          <p className={st.error}>{authError}</p>
          <p className={st.text}>Open the verification email from IFF Cargo, follow the link, then sign in again.</p>
          <div className={st.actions}>
            <button type="button" className={st.btnPrimary} onClick={() => { setAuthError(null); loginWithRedirect(); }}>Sign in again</button>
            <button type="button" className={st.linkBtn} onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Use a different account</button>
            <a href="/" className={st.linkBtn}>IFF Cargo home</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={st.screen} role="status">
      <img src="/logo.svg" alt="IFF Cargo" className={st.logo} />
      <p className={st.status}>Opening sign-in…</p>
    </div>
  );
}
