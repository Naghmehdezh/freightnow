export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Token getter — set by AuthBridge when user is authenticated
let tokenGetter = null;

export function setTokenGetter(fn) {
  tokenGetter = fn;
}

export async function fetchAPI(path, options = {}) {
  let token = null;
  if (tokenGetter) {
    try { token = await tokenGetter(); } catch (e) { console.warn('[API] Token fetch failed:', e.message || e); }
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw data;
  return data;
}
