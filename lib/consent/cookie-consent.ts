"use client";

/**
 * Cookie consent banner: a per-browser preference (localStorage, not a
 * per-user/tenant DB row -- this is decided before anyone signs in, and
 * has nothing to do with tenant isolation). Essential cookies (auth,
 * security, core app operation) are never gated by this -- the app
 * can't function without them and this consent model doesn't pretend
 * otherwise; only `analytics` is a real optional choice here.
 *
 * Honesty note: this app has no analytics/tracking library wired up
 * today, so `analytics: true` currently only records the user's
 * *preference*, not a live script being enabled -- this is the natural
 * gate to check before ever loading one, not a currently-functioning
 * toggle. Nothing here claims otherwise to the user.
 */
export interface CookieConsent {
  essential: true;
  analytics: boolean;
  timestamp: string;
}

const STORAGE_KEY = "cookie-consent";

export function readCookieConsent(): CookieConsent | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieConsent;
    return parsed?.essential === true ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCookieConsent(analytics: boolean): CookieConsent {
  const consent: CookieConsent = { essential: true, analytics, timestamp: new Date().toISOString() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    // Private browsing / storage disabled -- the choice just won't
    // persist across visits, same graceful-degradation posture as
    // SubscriptionBanner's own dismissal storage.
  }
  return consent;
}
