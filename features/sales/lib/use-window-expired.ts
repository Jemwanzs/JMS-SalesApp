"use client";

import { useEffect, useState } from "react";

/**
 * Drives the Delete icon's (always minutes-based) and the Correct
 * button's (hours-mode only) "must automatically disappear once the
 * configured period expires" requirement, without a page reload -- a
 * ~15s re-render tick is plenty of precision for a window measured in
 * minutes/hours.
 *
 * `windowMinutes: null` means "never expires client-side" -- used for
 * the edit window's default 'business_day' mode, whose real expiry is
 * server-computed (the business day closing) rather than a fixed
 * duration from a timestamp; that mode's button availability just
 * reflects server state as of the last page load/filter navigation,
 * which is the existing standard for every other permission flag in
 * this app, not something worth live-polling for.
 */
export function useWindowExpired(sinceIso: string, windowMinutes: number | null): boolean {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (windowMinutes === null) return;
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, [windowMinutes]);

  if (windowMinutes === null) return false;
  const expiresAt = new Date(sinceIso).getTime() + windowMinutes * 60_000;
  return now >= expiresAt;
}
