import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

// Read once at build/start time -- next.config.ts runs in plain Node, not
// the client bundle, so process.env is safe here regardless of the
// NEXT_PUBLIC_ prefix. Falls back to an empty pattern list (no crash) if
// the env var is ever missing at config-eval time, since a broken image
// domain shouldn't take down the whole build.
const supabaseHostname = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

// Hardening roadmap Phase 1 (docs/22-hardening-roadmap.md): CSP + baseline
// security headers, and Supabase Storage as a real next/image remote
// pattern so product photos stop needing `unoptimized` (that flag was
// almost certainly there specifically because this config was empty).
const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
  async headers() {
    return [
      {
        // Every route -- this is a same-origin app with no third-party
        // embed use case, so a single blanket policy is correct rather
        // than per-route tuning.
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js dev/HMR and inline bootstrap scripts need these;
              // tightening this further (nonces) is a real project of its
              // own, not a Phase 1 quick win -- see docs/22-hardening-roadmap.md.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              `img-src 'self' data: blob:${supabaseHostname ? ` https://${supabaseHostname}` : ""}`,
              // Paystack checkout is a full top-level redirect
              // (window.location.href to authorizationUrl/checkoutUrl,
              // never an embedded widget/iframe -- lib/paystack/client.ts
              // is server-only), so it needs no connect-src/frame-src
              // allowance here; CSP doesn't govern top-level navigation.
              // Sentry's browser SDK (Phase 4.1) DOES need one -- its
              // ingest endpoint is a region-specific subdomain
              // (o<id>.ingest.<region>.sentry.io); this covers the
              // regions Sentry actually offers today. Re-check against
              // the real DSN once a Sentry project exists -- an
              // unlisted region would silently have its client-side
              // error reports blocked by this same CSP, not sent
              // anywhere with an error visible in the console instead.
              `connect-src 'self'${supabaseHostname ? ` https://${supabaseHostname} wss://${supabaseHostname}` : ""} https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

// Hardening roadmap Phase 4.1: uploads source maps to Sentry at build
// time (so stack traces show real code, not minified output) and
// injects the release/tunnel wiring instrumentation.ts and
// instrumentation-client.ts rely on. SENTRY_AUTH_TOKEN/SENTRY_ORG/
// SENTRY_PROJECT being unset (true until a real Sentry project exists)
// makes this step a no-op with a build-log warning, not a failure --
// same safe-by-default posture as the empty DSN in the instrumentation
// files themselves, and why this doesn't break the CI build (Phase 2.7)
// or local `next build` before those env vars are ever set.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  // Source maps are deleted after upload by default (sourcemaps.deleteSourcemapsAfterUpload) -- no separate "hide" flag needed.
  webpack: {
    treeshake: { removeDebugLogging: true },
    reactComponentAnnotation: { enabled: true },
  },
});
