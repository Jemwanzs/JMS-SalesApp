"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * Hardening roadmap Phase 2.6 (docs/22-hardening-roadmap.md). Next.js
 * requirement, not a duplicate of error.tsx: this is the ONLY boundary
 * that can catch an error thrown by the root layout itself, so it must
 * render its own complete <html>/<body> -- the normal root layout never
 * gets a chance to run when this is what's rendering. Deliberately
 * plain (no shared components, no Tailwind utility classes beyond
 * basics, inline styles) -- if something is broken badly enough to reach
 * this boundary, the fallback shouldn't risk depending on anything else
 * in the app that might also be broken. Sentry is the one exception
 * (Phase 4.1) -- it's specifically built to stay safe to call from a
 * degraded app, and Sentry's own docs treat wiring it into this exact
 * file as standard practice, not a risk.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          textAlign: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#FAF3E6",
          color: "#1a1a1a",
        }}
      >
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#6b6b6b", maxWidth: 320, margin: 0 }}>
            The app ran into a problem loading. Your data is safe — try reloading the page.
          </p>
        </div>
        <button
          onClick={reset}
          style={{
            background: "#10786A",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
