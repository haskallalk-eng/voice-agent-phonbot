import type { FastifyBaseLogger } from 'fastify';

// Module-level code and background jobs don't have a FastifyRequest in scope,
// so they can't use req.log. We wire Fastify's root logger (app.log) once at
// boot via setBgLogger(), then expose it through `log` + `logBg`.
//
// Why this matters: silently swallowing errors with `.catch(() => {})` hides
// background-job failures (prompt consolidation, training export, cleanup).
// Sentry (wired into the pino pipeline) never sees them. We replace those
// silent catches with `.catch(logBg('op-name'))` to get the Sentry breadcrumb.

let rootLog: FastifyBaseLogger | null = null;

export function setBgLogger(l: FastifyBaseLogger) {
  rootLog = l;
}

// Fallback to console.* before the Fastify logger is initialised (module load,
// early boot). Keeps the signature identical to pino so call sites don't care.
const fallback: Pick<FastifyBaseLogger, 'warn' | 'error' | 'info'> = {
  warn: (objOrMsg: unknown, msg?: string) => {
    console.warn(msg ?? (typeof objOrMsg === 'string' ? objOrMsg : ''), objOrMsg);
  },
  error: (objOrMsg: unknown, msg?: string) => {
    console.error(msg ?? (typeof objOrMsg === 'string' ? objOrMsg : ''), objOrMsg);
  },
  info: (objOrMsg: unknown, msg?: string) => {
    console.info(msg ?? (typeof objOrMsg === 'string' ? objOrMsg : ''), objOrMsg);
  },
};

export const log = {
  warn(obj: Record<string, unknown>, msg: string) {
    (rootLog ?? fallback).warn(obj, msg);
  },
  error(obj: Record<string, unknown>, msg: string) {
    (rootLog ?? fallback).error(obj, msg);
  },
  info(obj: Record<string, unknown>, msg: string) {
    (rootLog ?? fallback).info(obj, msg);
  },
};

// Shorthand for fire-and-forget background ops:
//   await someOp().catch(logBg('op-name', { orgId }));
// Logs at warn with op+err context; does NOT rethrow.
export const logBg = (op: string, extra?: Record<string, unknown>) =>
  (err: unknown) => {
    log.warn(
      {
        op,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        ...extra,
      },
      `bg op failed: ${op}`,
    );
  };
