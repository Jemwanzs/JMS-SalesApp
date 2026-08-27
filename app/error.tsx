"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Hardening roadmap Phase 2.6 (docs/22-hardening-roadmap.md): no error
 * boundary existed anywhere in the app before this -- an unhandled
 * render error fell through to Next's bare default screen, unreported.
 * Catches everything below the root layout (root layout's own render
 * errors are global-error.tsx's job instead, a Next.js requirement).
 *
 * Sentry.captureException wired in via Phase 4.1 -- a no-op until
 * NEXT_PUBLIC_SENTRY_DSN is actually set (see instrumentation.ts's own
 * header comment), console.error stays alongside it as the always-on
 * local/dev fallback regardless of whether Sentry is configured.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          This page ran into a problem. Your data is safe — try again, or go back and pick up where you left off.
        </p>
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
