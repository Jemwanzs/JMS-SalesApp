import * as Sentry from "@sentry/nextjs";

// Hardening roadmap Phase 4.1 (docs/22-hardening-roadmap.md). Browser
// half of Sentry init -- see instrumentation.ts's header comment for
// the server/edge half and the no-DSN-is-a-safe-no-op note (same here).
//
// Session Replay is deliberately OFF (0 sample rates, not just unset):
// this app's screens show real sales/financial/PII data, and turning
// screen recording on is a real product/privacy decision this hardening
// pass isn't making on its own -- revisit deliberately, don't default
// it on.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

// Required export (Sentry's own build-time check flags its absence) so
// client-side route changes show up as spans instead of the SDK only
// ever seeing the very first page load.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
