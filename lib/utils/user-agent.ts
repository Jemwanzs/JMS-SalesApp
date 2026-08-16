/**
 * Best-effort browser/OS extraction from a User-Agent string -- not a
 * guaranteed physical-device fingerprint, per docs/05-authentication-
 * security.md's own note on login_events/sessions. A small hand-rolled
 * regex parser rather than a new dependency, since "best-effort" is
 * explicitly all that's asked for here.
 */
export function parseUserAgent(userAgent: string | null): { browser: string | null; os: string | null } {
  if (!userAgent) return { browser: null, os: null };

  let browser: string | null = null;
  if (/edg\//i.test(userAgent)) browser = "Edge";
  else if (/chrome\//i.test(userAgent) && !/chromium/i.test(userAgent)) browser = "Chrome";
  else if (/firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/safari\//i.test(userAgent) && !/chrome/i.test(userAgent)) browser = "Safari";
  else if (/opr\/|opera/i.test(userAgent)) browser = "Opera";

  // iPhone/iPad checked before "Mac OS X" -- every iOS UA includes the
  // legacy compatibility token "like Mac OS X" (e.g. "iPhone OS 17_0
  // like Mac OS X"), which would otherwise misclassify it as desktop
  // macOS.
  let os: string | null = null;
  if (/windows/i.test(userAgent)) os = "Windows";
  else if (/iphone|ipad/i.test(userAgent)) os = "iOS";
  else if (/mac os x|macintosh/i.test(userAgent)) os = "macOS";
  else if (/android/i.test(userAgent)) os = "Android";
  else if (/linux/i.test(userAgent)) os = "Linux";

  return { browser, os };
}

export function parseDeviceType(userAgent: string | null): "mobile" | "tablet" | "desktop" | null {
  if (!userAgent) return null;
  if (/ipad|tablet/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

export function deviceLabel(userAgent: string | null): string {
  const { browser, os } = parseUserAgent(userAgent);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
