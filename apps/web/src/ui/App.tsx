import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../lib/auth.js';
import { getAgentConfig, resendVerification, type AgentConfig } from '../lib/api.js';
import { LandingPage } from './landing/index.js';
import { ContactPage } from './landing/ContactPage.js';
import { LoginPage } from './LoginPage.js';
import { OnboardingWizard } from './onboarding/OnboardingWizard.js';
import { Sidebar } from './Sidebar.js';
import { DashboardHome } from './DashboardHome.js';
import { AgentBuilder } from './agent-builder/index.js';
import { TestConsole } from './TestConsole.js';
import { TicketInbox } from './TicketInbox.js';
import { CallLog } from './CallLog.js';
import { BillingPage } from './BillingPage.js';
import { PhoneManager } from './PhoneManager.js';
import { CalendarPage } from './CalendarPage.js';
import { InsightsPage } from './InsightsPage.js';
import { ToastProvider } from './Toast.js';
import { FoxLogo, PhonbotBrand } from './FoxLogo.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import { ChipyCopilot } from '../components/ChipyCopilot.js';
import { AdminPage } from './AdminPage.js';
import { ResetPasswordPage } from './ResetPasswordPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ── Error Boundary ─────────────────────────────────────────────────────────────

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0F] text-white gap-6 px-4">
          <FoxLogo size="xl" glow />
          <h1 className="text-2xl font-bold text-center">Ups, da ist etwas schiefgelaufen.</h1>
          <p className="text-white/40 text-sm text-center">Bitte Seite neu laden.</p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl px-6 py-3 font-semibold text-white text-sm transition-all duration-200 hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #F97316, #06B6D4)' }}
          >
            Seite neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export type Page = 'home' | 'agent' | 'test' | 'tickets' | 'logs' | 'billing' | 'phone' | 'calendar' | 'insights';

function Dashboard() {
  const { user, org, logout } = useAuth();
  const VALID_PAGES: Page[] = ['home', 'agent', 'test', 'tickets', 'logs', 'billing', 'phone', 'calendar', 'insights'];
  // Hash format: `#page` OR `#page/itemId` — the second form lets the dashboard
  // deep-link into a specific ticket/call/booking so clicking a row there
  // opens that exact row on the target page.
  const parseHash = (): { page: Page; focusId: string | null } => {
    const h = window.location.hash.replace('#', '');
    if (!h) return { page: 'home', focusId: null };
    const [p, id] = h.split('/');
    const candidate = p as Page;
    return {
      page: VALID_PAGES.includes(candidate) ? candidate : 'home',
      focusId: id ?? null,
    };
  };
  const initialPage = (): Page => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('calendarConnected') || params.has('calendarError')) return 'calendar';
    return parseHash().page;
  };
  const [page, setPage] = useState<Page>(initialPage);
  const [focusId, setFocusId] = useState<string | null>(() => parseHash().focusId);

  // Combined navigator — target pages read focusId prop to scroll-to /
  // highlight the item. Second call with only `p` clears focusId.
  const navigate = (p: Page, id?: string | null) => {
    setPage(p);
    setFocusId(id ?? null);
  };

  // Persist current page+focusId in URL hash so reload / copy-paste works.
  useEffect(() => {
    const base = page === 'home' ? '' : `#${page}`;
    const newHash = base && focusId ? `${base}/${focusId}` : base;
    if (window.location.hash !== newHash) {
      window.history.pushState(null, '', newHash || window.location.pathname + window.location.search);
    }
  }, [page, focusId]);

  // L7: Sync page state with browser back/forward navigation
  useEffect(() => {
    const onPopState = () => {
      const parsed = parseHash();
      setPage(parsed.page);
      setFocusId(parsed.focusId);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [showVerifyBanner, setShowVerifyBanner] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [verifySent, setVerifySent] = useState(false);

  useEffect(() => {
    // Always ask the server whether the user has a configured agent.
    // Previously, a stale `phonbot_onboarding` key in localStorage would
    // force onboarding even for users who already completed it — causing
    // the "warum muss ich das Onboarding nochmal machen?" bug.
    getAgentConfig()
      .then((cfg: AgentConfig) => {
        const configured = cfg.businessName && cfg.businessName !== 'Demo Business';
        if (configured) {
          // Agent exists → clear any stale onboarding state
          try { localStorage.removeItem('phonbot_onboarding'); } catch { /* */ }
          setNeedsOnboarding(false);
        } else {
          setNeedsOnboarding(true);
        }
      })
      .catch(() => {
        // API error (e.g. first-time user, DB down) → show onboarding
        setNeedsOnboarding(true);
      });
  }, []);

  // Check email verification status from user object
  useEffect(() => {
    if (user && 'email_verified' in user) {
      const verified = (user as Record<string, unknown>).email_verified as boolean;
      setEmailVerified(verified);
      setShowVerifyBanner(verified === false);
    }
  }, [user]);

  async function handleResendVerification() {
    setVerifyError(null);
    try {
      await resendVerification();
      setVerifySent(true);
      // Reset after 5 seconds so they can resend again if needed
      setTimeout(() => setVerifySent(false), 5000);
    } catch {
      // Surface the failure instead of swallowing — user otherwise keeps
      // clicking and can't tell why nothing happens. Plain message, no
      // raw error body (avoid leaking backend details). D7.
      setVerifyError('Mail-Versand schlug fehl — bitte später erneut versuchen oder info@phonbot.de kontaktieren.');
      setTimeout(() => setVerifyError(null), 8000);
    }
  }

  if (needsOnboarding === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F]">
        <p className="text-white/30 text-sm">Laden…</p>
      </div>
    );
  }

  if (needsOnboarding) {
    return <OnboardingWizard onComplete={() => setNeedsOnboarding(false)} />;
  }

  return (
    <div className="flex h-screen bg-[#0A0A0F] text-white">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[#0F0F18] border-b border-white/5 px-4 py-3 flex items-center justify-between">
        <button onClick={() => setSidebarOpen(true)} className="text-white/70 hover:text-white" aria-label="Menü öffnen">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <PhonbotBrand size="sm" />
        <div className="w-6" />
      </div>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="relative z-10 w-64">
            <Sidebar
              current={page}
              onNavigate={(p) => { navigate(p); setSidebarOpen(false); }}
              org={org}
              user={user}
              onLogout={logout}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar current={page} onNavigate={(p) => navigate(p)} org={org} user={user} onLogout={logout} />
      </div>

      <main className="flex-1 overflow-y-auto md:ml-0 mt-12 md:mt-0 relative">
        {/* Ambient glow orbs */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden" style={{ zIndex: 0 }}>
          {[
            { w: 600, t: '-5%', r: '-8%', c: '249,115,22', o: 0.08, b: 70, s: 40, d: 0 },
            { w: 500, b2: '0%', l: '-5%', c: '6,182,212', o: 0.04, b: 60, s: 50, d: 0, rev: true },
            { w: 400, t: '35%', r: '10%', c: '249,115,22', o: 0.06, b: 55, s: 55, d: -12 },
            { w: 450, t: '10%', l: '15%', c: '6,182,212', o: 0.03, b: 55, s: 45, d: -18, rev: true },
            { w: 300, b2: '15%', r: '25%', c: '249,115,22', o: 0.07, b: 50, s: 48, d: -8 },
            { w: 350, t: '55%', l: '40%', c: '6,182,212', o: 0.03, b: 55, s: 60, d: -25, rev: true },
            { w: 250, t: '5%', l: '50%', c: '249,115,22', o: 0.06, b: 45, s: 42, d: -5 },
            { w: 280, t: '70%', l: '-2%', c: '6,182,212', o: 0.035, b: 50, s: 52, d: -20, rev: true },
            { w: 220, t: '45%', l: '75%', c: '249,115,22', o: 0.05, b: 40, s: 46, d: -15 },
            { w: 320, t: '20%', r: '-3%', c: '6,182,212', o: 0.035, b: 50, s: 56, d: -10, rev: true },
            { w: 200, t: '80%', l: '30%', c: '249,115,22', o: 0.055, b: 40, s: 50, d: -22 },
            { w: 270, b2: '10%', l: '60%', c: '6,182,212', o: 0.03, b: 45, s: 58, d: -14, rev: true },
          ].map((g, i) => (
            <div key={i} className="absolute rounded-full" style={{
              width: g.w, height: g.w,
              top: g.t ?? undefined, bottom: g.b2 ?? undefined,
              left: g.l ?? undefined, right: g.r ?? undefined,
              background: `radial-gradient(circle, rgba(${g.c},${g.o}) 0%, transparent 60%)`,
              filter: `blur(${g.b}px)`,
              animation: `ambient-drift ${g.s}s ease-in-out infinite${g.rev ? ' reverse' : ''}`,
              animationDelay: `${g.d}s`,
            }} />
          ))}
        </div>
        {/* Email verification banner */}
        {showVerifyBanner && emailVerified === false && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-amber-300">
              <span>📧</span>
              {verifyError ? (
                <span className="text-red-300 font-medium" role="alert">⚠ {verifyError}</span>
              ) : verifySent ? (
                <span className="text-green-300 font-medium">✓ E-Mail gesendet!</span>
              ) : (
                <span>
                  Bitte bestätige deine E-Mail-Adresse.{' '}
                  <button
                    onClick={handleResendVerification}
                    className="underline font-medium hover:text-amber-200 transition-colors"
                  >
                    Bestätigungs-E-Mail erneut senden
                  </button>
                </span>
              )}
            </div>
            <button
              onClick={() => setShowVerifyBanner(false)}
              className="text-amber-300/50 hover:text-amber-300 transition-colors ml-4 shrink-0"
              aria-label="Schließen"
            >
              ✕
            </button>
          </div>
        )}

        {/* Page content — key forces React to remount on navigation,
            triggering the fade-up CSS animation for a smooth transition. */}
        <div key={page} className="fade-up">
          {page === 'home' && <DashboardHome onNavigate={navigate} />}
          {page === 'agent' && <AgentBuilder onNavigate={setPage} />}
          {page === 'test' && <TestConsole onNavigate={setPage} />}
          {page === 'tickets' && <TicketInbox focusId={focusId} />}
          {page === 'logs' && <CallLog focusId={focusId} />}
          {page === 'billing' && <BillingPage />}
          {page === 'phone' && <PhoneManager onNavigate={setPage as (page: string) => void} />}
          {page === 'calendar' && <CalendarPage focusBookingId={focusId} />}
          {page === 'insights' && <InsightsPage />}
        </div>
      </main>

      {/* Chipy Copilot — floating chat assistant, visible on all dashboard pages */}
      <ChipyCopilot />
    </div>
  );
}

type Gate = 'landing' | 'login' | 'register' | 'contact' | 'app';

function readGateFromUrl(): Gate {
  if (typeof window === 'undefined') return 'landing';
  const page = new URLSearchParams(window.location.search).get('page');
  return page === 'contact' || page === 'login' || page === 'register' ? page : 'landing';
}

function writeGateToUrl(gate: Gate, mode: 'push' | 'replace' = 'push') {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (gate === 'landing' || gate === 'app') {
    url.searchParams.delete('page');
  } else {
    url.searchParams.set('page', gate);
  }
  const next = url.toString();
  if (next === window.location.href) return;
  if (mode === 'replace') window.history.replaceState({}, '', next);
  else window.history.pushState({}, '', next);
}

function AppGate() {
  const { token, user, bootstrapping, finalizeCheckout } = useAuth();
  // Stripe success redirect. Stripe substitutes {CHECKOUT_SESSION_ID} for the
  // real id. We finalize the account creation exactly once on mount and strip
  // the param so a reload doesn't re-fire.
  const [finalizing, setFinalizing] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const sid = new URLSearchParams(window.location.search).get('checkoutSession');
    if (!sid || sid === '{CHECKOUT_SESSION_ID}') return null;
    return sid;
  });
  useEffect(() => {
    if (!finalizing) return;
    let cancelled = false;
    (async () => {
      try {
        await finalizeCheckout(finalizing);
      } catch { /* user will see the landing page with an error toast-less — non-critical */ }
      finally {
        if (cancelled) return;
        const url = new URL(window.location.href);
        url.searchParams.delete('checkoutSession');
        window.history.replaceState({}, '', url.toString());
        setFinalizing(null);
      }
    })();
    return () => { cancelled = true; };
  }, [finalizing, finalizeCheckout]);
  // Initial gate can be deep-linked from static sub-pages (industry landings) via
  // ?page=contact | login | register. Let /?page=contact → ContactPage on first load
  // so the industry-page nav can link straight to those gates.
  const [gate, setGate] = useState<Gate>(() => {
    if (typeof window === 'undefined') return 'landing';
    const params = new URLSearchParams(window.location.search);
    const p = params.get('page');
    // Plan deep-link from branch landings (e.g. /?page=register&plan=starter)
    // → BillingPage reads this from sessionStorage after signup. Strip from URL.
    const plan = params.get('plan');
    if (plan) {
      try {
        sessionStorage.setItem('preselectedPlan', plan);
        const interval = params.get('interval');
        if (interval === 'year' || interval === 'month') {
          sessionStorage.setItem('preselectedInterval', interval);
        }
      } catch { /* sessionStorage may throw in privacy mode */ }
    }
    if (p === 'contact' || p === 'login' || p === 'register') {
      if (plan) {
        const url = new URL(window.location.href);
        url.searchParams.delete('plan');
        url.searchParams.delete('interval');
        window.history.replaceState({}, '', url.toString());
      }
      return p as Gate;
    }
    if (plan) {
      const url = new URL(window.location.href);
      url.searchParams.delete('plan');
      url.searchParams.delete('interval');
      window.history.replaceState({}, '', url.toString());
    }
    return 'landing';
  });

  useEffect(() => {
    const onPopState = () => setGate(readGateFromUrl());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigateGate(next: Gate) {
    setGate(next);
    writeGateToUrl(next);
  }

  // Wait for the auth bootstrap to finish before deciding landing-vs-Dashboard.
  // Without this the user briefly sees the landing page on a reload even though
  // they have a valid refresh cookie (F-14). Same spinner covers the short
  // interval during which /auth/finalize-checkout is in-flight after Stripe.
  if (bootstrapping || (token && !user) || finalizing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F]">
        <p className="text-white/30 text-sm">
          {finalizing ? 'Zahlung bestätigt — dein Konto wird eingerichtet…' : 'Laden…'}
        </p>
      </div>
    );
  }

  if (token && user) return <Dashboard />;

  if (gate === 'landing') {
    return (
      <LandingPage
        onGoToRegister={() => navigateGate('register')}
        onGoToLogin={() => navigateGate('login')}
        onGoToContact={() => navigateGate('contact')}
      />
    );
  }

  if (gate === 'contact') {
    return (
      <ContactPage
        onGoToRegister={() => navigateGate('register')}
        onGoToLogin={() => navigateGate('login')}
        onBack={() => navigateGate('landing')}
      />
    );
  }

  return (
    <LoginPage
      onGoToLanding={() => navigateGate('landing')}
      onModeChange={(next) => navigateGate(next)}
      initialMode={gate === 'register' ? 'register' : 'login'}
    />
  );
}

export function App() {
  // Password reset: standalone page, no auth provider needed
  if (window.location.pathname === '/reset-password') {
    return (
      <ErrorBoundary>
        <ResetPasswordPage />
      </ErrorBoundary>
    );
  }

  // Admin panel: standalone page, no auth provider needed
  const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');

  if (isAdminRoute) {
    return (
      <ErrorBoundary>
        <AdminPage />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ConnectionStatus />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <AppGate />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
