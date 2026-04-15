import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

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

const TOKEN_KEY = 'vas_token';

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
async function tryRefresh(): Promise<string | null> {
  try {
    const data = await apiFetch<{ token: string }>('/auth/refresh', { method: 'POST' });
    if (data?.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
      return data.token;
    }
  } catch { /* refresh failed → caller logs out */ }
  return null;
}

type AuthResponse = { token: string; user: AuthUser; org: AuthOrg };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    return { token, user: null, org: null };
  });

  // On mount: try /auth/me with the current access token; if that 401s, attempt
  // one refresh (the refresh cookie may still be valid even if the access JWT
  // expired in localStorage). On second failure → fully log out.
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      // Even without a token, the refresh cookie might still be valid (e.g. user
      // returns after access JWT expired). Try refresh first if no token.
      let token = state.token;
      if (!token) {
        token = await tryRefresh();
        if (!token) return; // truly logged out
      }

      const fetchMe = (t: string) => apiFetch<{ id: string; email: string; role: string; org_id: string; org_name: string; org_slug: string }>(
        '/auth/me',
        { headers: { authorization: `Bearer ${t}` } },
      );

      try {
        const me = await fetchMe(token);
        if (cancelled) return;
        setState({
          token,
          user: { id: me.id, email: me.email, role: me.role as AuthUser['role'] },
          org: { id: me.org_id, name: me.org_name, slug: me.org_slug },
        });
      } catch {
        // Access token expired/invalid → try refresh once
        const refreshed = await tryRefresh();
        if (!refreshed) {
          if (cancelled) return;
          localStorage.removeItem(TOKEN_KEY);
          setState({ token: null, user: null, org: null });
          return;
        }
        try {
          const me = await fetchMe(refreshed);
          if (cancelled) return;
          setState({
            token: refreshed,
            user: { id: me.id, email: me.email, role: me.role as AuthUser['role'] },
            org: { id: me.org_id, name: me.org_name, slug: me.org_slug },
          });
        } catch {
          if (cancelled) return;
          localStorage.removeItem(TOKEN_KEY);
          setState({ token: null, user: null, org: null });
        }
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
    localStorage.setItem(TOKEN_KEY, data.token);
    setState({ token: data.token, user: data.user, org: data.org });
  }, []);

  const register = useCallback(async (orgName: string, email: string, password: string) => {
    const data = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ orgName, email, password }),
    });
    localStorage.setItem(TOKEN_KEY, data.token);
    setState({ token: data.token, user: data.user, org: data.org });
  }, []);

  const logout = useCallback(() => {
    // Server-side: revoke refresh token + clear cookie. Fire-and-forget — local
    // logout must always succeed even if the network call fails.
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {});
    localStorage.removeItem(TOKEN_KEY);
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
