'use client';
import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function LoginPage() {
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', padding: '20px' }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>&#9993;</div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 700, color: 'var(--navy)', marginBottom: 12 }}>
            Email verification required
          </h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 24 }}>
            {authError}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 24 }}>
            Check your inbox for a verification email from IFF Cargo, click the link to verify, then try logging in again.
          </p>
          <button
            onClick={() => { setAuthError(null); loginWithRedirect(); }}
            style={{
              padding: '12px 32px', background: 'var(--navy)', border: 'none', borderRadius: 8,
              fontFamily: 'var(--display)', fontSize: 14, fontWeight: 700, color: '#fff', cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
              style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--navy)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Use a different account
            </button>
            <a href="/" style={{ fontSize: 13, color: 'var(--text3)' }}>Back to home</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <p>Redirecting to login...</p>
    </div>
  );
}
