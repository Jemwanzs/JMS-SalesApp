import * as Sentry from "@sentry/nextjs";

// Hardening roadmap Phase 4.1 (docs/22-hardening-roadmap.md): several
// docs described Sentry as already wired in -- it wasn't, anywhere in
// the repo. This is Next.js's own instrumentation hook (stable since
// Next 15, no experimental flag needed), the server/edge half of the
// setup; instrumentation-client.ts is the browser half.
//
// Sentry.init({dsn: undefined}) is a deliberately supported no-op mode
// -- with NEXT_PUBLIC_SENTRY_DSN unset (true until a real Sentry
// project exists), this safely does nothing rather than erroring, so
// this file is safe to ship before that account exists.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      // 10%, not 100% -- a sane default before a real Sentry plan's
      // quota is known; revisit once billing is actually set up.
      tracesSampleRate: 0.1,
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

// Next.js's own hook for errors thrown during request handling (Server
// Components, Route Handlers, Server Actions) that never reach a React
// error boundary -- app/error.tsx only catches render-time errors on
// the client, this catches the server-side ones a boundary can't see.
export const onRequestError = Sentry.captureRequestError;
