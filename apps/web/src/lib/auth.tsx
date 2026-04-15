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
};

type AuthContextValue = AuthState & {
  login: (email: string, password: string) => Promise<void>;
  register: (orgName: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Access JWT is held in memory only (module scope in api.ts + React state here).
// The long-lived refresh credential lives as httpOnly cookie set by the API —
// this means XSS cannot lift the access token from localStorage the way it
// used to. Fixes F-01.

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // 10s timeout — prevents hung logins/me-calls from freezing the UI indefinitely
  // if the API is unreachable (e.g. during deploy). AbortSignal.timeout is widely
  // supported in all modern browsers; we use `any` fallback to combine with a
  // caller-supplied signal if one was passed.
  // credentials: 'include' so the httpOnly refresh-token cookie is sent on
  // /auth/refresh and /auth/logout (set by backend with path=/auth, sameSite=strict).
  const res = await fetch(`/api${path}`, {
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

// Try to swap the refresh cookie for a fresh access token. Returns the new
// token on success, null on failure (refresh expired/revoked → user must log in).
// Publishes the token into the api.ts module store so request() can pick it up.
async function tryRefresh(): Promise<string | null> {
  try {
    const data = await apiFetch<{ token: string }>('/auth/refresh', { method: 'POST' });
    if (data?.token) {
      setAccessToken(data.token);
      return data.token;
    }
  } catch { /* refresh failed → caller logs out */ }
  return null;
}

type AuthResponse = { token: string; user: AuthUser; org: AuthOrg };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Access JWT starts null every session; bootstrap below tries to swap the
  // httpOnly refresh cookie for a fresh one. Never read from localStorage.
  const [state, setState] = useState<AuthState>({ token: null, user: null, org: null });

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
      if (!token) return; // truly logged out

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
        });
      } catch {
        if (cancelled) return;
        setAccessToken(null);
        setState({ token: null, user: null, org: null });
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
    setState({ token: data.token, user: data.user, org: data.org });
  }, []);

  const register = useCallback(async (orgName: string, email: string, password: string) => {
    const data = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ orgName, email, password }),
    });
    setState({ token: data.token, user: data.user, org: data.org });
  }, []);

  const logout = useCallback(() => {
    // Server-side: revoke refresh token + clear cookie. Fire-and-forget — local
    // logout must always succeed even if the network call fails.
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    // Wipe any stale app-state keys that should not survive a logout (F-08).
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('phonbot_')) localStorage.removeItem(k);
      }
    } catch { /* storage unavailable */ }
    setAccessToken(null);
    setState({ token: null, user: null, org: null });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
