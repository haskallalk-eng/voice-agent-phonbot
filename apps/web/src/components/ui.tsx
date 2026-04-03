import React, { useEffect, useRef, useCallback } from 'react';
import DOMPurify from 'dompurify';

/* ── Sanitized HTML ────────────────────────────────── */

export function SafeHTML({ html, className }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />;
}

export function sanitize(text: string): string {
  return DOMPurify.sanitize(text);
}

/* ── Button ────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: React.ReactNode;
};

const btnBase = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-orange-500/50 px-4 py-2.5 text-sm';

const btnVariants: Record<ButtonVariant, string> = {
  primary: 'text-white hover:scale-105 active:scale-95',
  secondary: 'bg-white/5 border border-white/10 text-white hover:bg-white/10 active:scale-95',
  danger: 'bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 active:scale-95',
  ghost: 'text-white/60 hover:text-white hover:bg-white/5 active:scale-95',
};

export function Button({ variant = 'secondary', loading, icon, children, className = '', disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`${btnBase} ${btnVariants[variant]} ${className}`}
      disabled={disabled || loading}
      style={variant === 'primary' ? { background: 'linear-gradient(135deg, #F97316, #EA580C)' } : undefined}
      {...props}
    >
      {loading ? <Spinner size="sm" /> : icon}
      {children}
    </button>
  );
}

/* ── Spinner ───────────────────────────────────────── */

export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-8 h-8' : 'w-5 h-5';
  return (
    <svg className={`${s} animate-spin text-current`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}

/* ── Skeleton Loader ───────────────────────────────── */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-white/10 rounded-lg ${className}`} />;
}

export function SkeletonCard() {
  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 space-y-4">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-3 pt-2">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-10 w-24" />
      </div>
    </div>
  );
}

/* ── Empty State ───────────────────────────────────── */

type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-white/20 mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-white/80 mb-1">{title}</h3>
      {description && <p className="text-sm text-white/40 max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}

/* ── Modal (accessible) ────────────────────────────── */

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
};

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement;
    document.addEventListener('keydown', handleKeyDown);
    // Focus first focusable element
    requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    });
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      prevFocus.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const sizeClass = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className={`${sizeClass} w-full bg-[#141420] border border-white/10 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 id="modal-title" className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/5" aria-label="Schließen">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ── Card ──────────────────────────────────────────── */

type CardProps = {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  const pad = padding === 'sm' ? 'p-4' : padding === 'lg' ? 'p-8' : 'p-6';
  return (
    <div className={`bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl ${pad} ${className}`}>
      {children}
    </div>
  );
}

/* ── Status Badge ──────────────────────────────────── */

type StatusType = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const statusStyles: Record<StatusType, string> = {
  success: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  warning: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  error: 'bg-red-500/20 text-red-400 border-red-500/30',
  info: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  neutral: 'bg-white/10 text-white/60 border-white/10',
};

export function StatusBadge({ status, children }: { status: StatusType; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusStyles[status]}`}>
      {children}
    </span>
  );
}

/* ── Page Header ───────────────────────────────────── */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        {description && <p className="text-sm text-white/50 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

/* ── Unsaved Changes Hook ──────────────────────────── */

export function useUnsavedChanges(hasChanges: boolean) {
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);
}
