'use client';
import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { setTokenGetter } from '@/lib/api';

export default function AuthBridge({ children }) {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();

  // Set token getter synchronously during render so child useEffects
  // (which fire before parent effects) already have access to it.
  if (isAuthenticated) {
    setTokenGetter(() => getAccessTokenSilently());
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setTokenGetter(null);
    }
  }, [isAuthenticated]);

  return children;
}
