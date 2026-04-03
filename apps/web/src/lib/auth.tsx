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
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

type AuthResponse = { token: string; user: AuthUser; org: AuthOrg };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    return { token, user: null, org: null };
  });

  // On mount: if we have a token, fetch /auth/me to restore user state
  useEffect(() => {
    if (!state.token) return;
    apiFetch<{ id: string; email: string; role: string; org_id: string; org_name: string; org_slug: string }>(
      '/auth/me',
      { headers: { authorization: `Bearer ${state.token}` } },
    )
      .then((me) => {
        setState({
          token: state.token,
          user: { id: me.id, email: me.email, role: me.role as AuthUser['role'] },
          org: { id: me.org_id, name: me.org_name, slug: me.org_slug },
        });
      })
      .catch(() => {
        // Token expired or invalid
        localStorage.removeItem(TOKEN_KEY);
        setState({ token: null, user: null, org: null });
      });
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
