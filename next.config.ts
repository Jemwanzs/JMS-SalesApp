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
              `connect-src 'self'${supabaseHostname ? ` https://${supabaseHostname} wss://${supabaseHostname}` : ""}`,
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

export default nextConfig;
