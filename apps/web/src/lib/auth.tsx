import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { setAccessToken } from './api';

export type AuthUser = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
};

export type AuthOrg = {
  id: string;
  name: string;
  slug: string;
};

export type AuthState = {
  token: string | null;
  user: AuthUser | null;
  org: AuthOrg | null;
  /**
   * True while the initial `/auth/refresh → /auth/me` bootstrap is still in
   * flight. Consumers use this to show a loading screen instead of briefly
   * flashing the landing page before the authed Dashboard takes over (F-14).
   */
  bootstrapping: boolean;
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  register: (
    orgName: string,
    email: string,
    password: string,
    flags: { isBusiness: true; termsAccepted: true },
  ) => Promise<void>;
  finalizeCheckout: (sessionId: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Access JWT is held in memory only (module scope in api.ts + React state here).
// The long-lived refresh credential lives as httpOnly cookie set by the API —
// this means XSS cannot lift the access token from localStorage the way it
// used to. Fixes F-01.

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  // 10s timeout — prevents hung logins/me-calls from freezing the UI indefinitely
  // if the API is unreachable (e.g. during deploy). AbortSignal.timeout is widely
  // supported in all modern browsers; we use `any` fallback to combine with a
  // caller-supplied signal if one was passed.
  // credentials: 'include' so the httpOnly refresh-token cookie is sent on
  // /api/auth/refresh and /api/auth/logout (backend cookie path=/api/auth).
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return fetchJson<T>(`/api${path}`, init);
}

// Cheap presence-check for the non-httpOnly hint cookie set by the API on
// login/refresh. JS can't see the httpOnly refresh cookie itself, so without
// this hint every anonymous landing-page visitor would trigger a 401 console
// error on bootstrap. Hint absent ⇒ definitely not logged in ⇒ skip refresh.
function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith('vas_has_session='));
}

// Try to swap the refresh cookie for a fresh access token. Returns the new
// token on success, null on failure (refresh expired/revoked → user must log in).
// Publishes the token into the api.ts module store so request() can pick it up.
async function tryRefresh(): Promise<string | null> {
  // Skip the network probe entirely when no hint cookie is present — anonymous
  // visitor on the landing page, no point asking the server.
  if (!hasSessionHint()) return null;

  const refreshUrls = ['/api/auth/refresh', '/auth/refresh'];
  for (const url of refreshUrls) {
    try {
      const data = await fetchJson<{ token: string }>(url, { method: 'POST' });
      if (data?.token) {
        setAccessToken(data.token);
        return data.token;
      }
    } catch {
      // Try the legacy visible path once. Older cookies were accidentally scoped
      // to /auth, so the browser will not send them to /api/auth/refresh.
    }
  }
  return null;
}

type AuthResponse = { token: string; user: AuthUser; org: AuthOrg };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Access JWT starts null every session; bootstrap below tries to swap the
  // httpOnly refresh cookie for a fresh one. Never read from localStorage.
  // bootstrapping=true blocks the app from rendering landing/login before
  // we know whether the user still has a valid refresh cookie (F-14).
  const [state, setState] = useState<AuthState>({ token: null, user: null, org: null, bootstrapping: true });

  // Keep api.ts's module-scoped token in sync with React state so request()
  // + direct fetches via getAccessToken() see the same value. F-08: on logout
  // this also clears the cached token used by those direct callers.
  useEffect(() => {
    setAccessToken(state.token);
  }, [state.token]);

  // On mount: refresh cookie → access token → /auth/me. If refresh fails,
  // user is truly logged out. The refresh cookie is httpOnly so JS can't
  // read it; we only probe via the /auth/refresh endpoint.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const token = await tryRefresh();
      if (!token) {
        // truly logged out — still clear bootstrapping so landing/login can render
        if (!cancelled) setState((s) => ({ ...s, bootstrapping: false }));
        return;
      }

      try {
        const me = await apiFetch<{ id: string; email: string; role: string; org_id: string; org_name: string; org_slug: string }>(
          '/auth/me',
          { headers: { authorization: `Bearer ${token}` } },
        );
        if (cancelled) return;
        setState({
          token,
          user: { id: me.id, email: me.email, role: me.role as AuthUser['role'] },
          org: { id: me.org_id, name: me.org_name, slug: me.org_slug },
          bootstrapping: false,
        });
      } catch {
        if (cancelled) return;
        setAccessToken(null);
        setState({ token: null, user: null, org: null, bootstrapping: false });
      }
    }
    bootstrap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    // Sync token to module store BEFORE React re-render so Dashboard's
    // initial requests already carry the Authorization header.
    setAccessToken(data.token);
    setState({ token: data.token, user: data.user, org: data.org, bootstrapping: false });
  }, []);

  const register = useCallback(async (
    orgName: string,
    email: string,
    password: string,
    flags: { isBusiness: true; termsAccepted: true },
  ) => {
    const data = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ orgName, email, password, ...flags }),
    });
    setAccessToken(data.token);
    setState({ token: data.token, user: data.user, org: data.org, bootstrapping: false });
  }, []);

  // After Stripe success redirect (`/?checkoutSession=X`), swap the session id
  // for a real token pair. Server verifies with Stripe and materializes the
  // account if the webhook hasn't already. Retries once on 404 — the webhook
  // may beat the browser back to the origin by a few hundred ms.
  const finalizeCheckout = useCallback(async (sessionId: string) => {
    const doCall = () => apiFetch<AuthResponse>('/auth/finalize-checkout', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
    let data: AuthResponse;
    try {
      data = await doCall();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (/not yet provisioned/i.test(msg)) {
        await new Promise(r => setTimeout(r, 1500));
        data = await doCall();
      } else {
        throw err;
      }
    }
    setAccessToken(data.token);
    setState({ token: data.token, user: data.user, org: data.org, bootstrapping: false });
  }, []);

  const logout = useCallback(() => {
    // Server-side: revoke refresh token + clear cookie. Fire-and-forget — local
    // logout must always succeed even if the network call fails.
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    // Wipe any stale app-state keys that should not survive a logout (F-08).
    // Covers localStorage and sessionStorage so a subsequent user doesn't see
    // the previous account's onboarding progress / UI prefs.
    try {
      for (const store of [localStorage, sessionStorage]) {
        for (let i = store.length - 1; i >= 0; i--) {
          const k = store.key(i);
          if (k && (k.startsWith('phonbot_') || k === 'vas_token')) store.removeItem(k);
        }
      }
    } catch { /* storage unavailable */ }
    setAccessToken(null);
    setState({ token: null, user: null, org: null, bootstrapping: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, finalizeCheckout, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
