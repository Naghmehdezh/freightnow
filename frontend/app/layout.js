'use client';
import './globals.css';
import { useRouter } from 'next/navigation';
import { Auth0Provider } from '@auth0/auth0-react';
import AuthBridge from '@/components/AuthBridge';
import NumberGuard from '@/components/NumberGuard';

export default function RootLayout({ children }) {
  const router = useRouter();

  function handleRedirectCallback(appState) {
    router.replace(appState?.returnTo || '/portal');
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Auth0Provider
          domain="dev-1j30e4bjorr1z8ps.us.auth0.com"
          clientId="tjR12i3hvfIoJhkaZxRpSCiFlf6x5bYT"
          authorizationParams={{
            redirect_uri: typeof window !== 'undefined' ? `${window.location.origin}/login` : '',
            audience: 'https://api.iffcargo.com',
          }}
          cacheLocation="localstorage"
          onRedirectCallback={handleRedirectCallback}
        >
          <NumberGuard />
          <AuthBridge>{children}</AuthBridge>
        </Auth0Provider>
      </body>
    </html>
  );
}
