"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js on mount. Client-only (service workers aren't
 * available during SSR) — mounted once from the root layout.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal: the app works fully without an installed service
      // worker, this only affects "Add to Home Screen" polish.
    });
  }, []);

  return null;
}
