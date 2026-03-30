import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from '../lib/auth.js';
import { getAgentConfig, resendVerification, type AgentConfig } from '../lib/api.js';
import { LandingPage } from './LandingPage.js';
import { LoginPage } from './LoginPage.js';
import { OnboardingWizard } from './onboarding/OnboardingWizard.js';
import { Sidebar } from './Sidebar.js';
import { DashboardHome } from './DashboardHome.js';
import { AgentBuilder } from './AgentBuilder.js';
import { TestConsole } from './TestConsole.js';
import { TicketInbox } from './TicketInbox.js';
import { CallLog } from './CallLog.js';
import { BillingPage } from './BillingPage.js';
import { PhoneManager } from './PhoneManager.js';
import { CalendarPage } from './CalendarPage.js';
import { InsightsPage } from './InsightsPage.js';
import { ToastProvider } from './Toast.js';
import { FoxLogo, PhonbotBrand } from './FoxLogo.js';

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
  const [page, setPage] = useState<Page>('home');
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showVerifyBanner, setShowVerifyBanner] = useState(false);
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null);
  const [verifySent, setVerifySent] = useState(false);

  useEffect(() => {
    getAgentConfig()
      .then((cfg: AgentConfig) => {
        setNeedsOnboarding(!cfg.businessName || cfg.businessName === 'Demo Business');
      })
      .catch(() => {
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
    try {
      await resendVerification();
      setVerifySent(true);
      // Reset after 5 seconds so they can resend again if needed
      setTimeout(() => setVerifySent(false), 5000);
    } catch {
      // silently fail — user can try again
    }
  }

  if (needsOnboarding === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F]">
        <p className="text-white/30 text-sm">Loading…</p>
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
        <button onClick={() => setSidebarOpen(true)} className="text-white/70 hover:text-white">
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
              onNavigate={(p) => { setPage(p); setSidebarOpen(false); }}
              org={org}
              user={user}
              onLogout={logout}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar current={page} onNavigate={setPage} org={org} user={user} onLogout={logout} />
      </div>

      <main className="flex-1 overflow-y-auto md:ml-0 mt-12 md:mt-0">
        {/* Email verification banner */}
        {showVerifyBanner && emailVerified === false && (
          <div className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-amber-300">
              <span>📧</span>
              {verifySent ? (
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

        {page === 'home' && <DashboardHome onNavigate={setPage} />}
        {page === 'agent' && <AgentBuilder />}
        {page === 'test' && <TestConsole />}
        {page === 'tickets' && <TicketInbox />}
        {page === 'logs' && <CallLog />}
        {page === 'billing' && <BillingPage />}
        {page === 'phone' && <PhoneManager />}
        {page === 'calendar' && <CalendarPage />}
        {page === 'insights' && <InsightsPage />}
      </main>
    </div>
  );
}

type Gate = 'landing' | 'login' | 'register' | 'app';

function AppGate() {
  const { token, user } = useAuth();
  const [gate, setGate] = useState<Gate>('landing');

  if (token && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0F]">
        <p className="text-white/30 text-sm">Loading…</p>
      </div>
    );
  }

  if (token && user) return <Dashboard />;

  if (gate === 'landing') {
    return (
      <LandingPage
        onGoToRegister={() => setGate('register')}
        onGoToLogin={() => setGate('login')}
      />
    );
  }

  return (
    <LoginPage
      onGoToLanding={() => setGate('landing')}
      initialMode={gate === 'register' ? 'register' : 'login'}
    />
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <AppGate />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
