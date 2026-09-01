import Link from "next/link";

/**
 * /support is a fully static, pre-login-reachable marketing page --
 * this stays a plain server component (no new auth/session plumbing
 * on that otherwise-static page) by reusing the `?from=/t/{slug}/more`
 * query param more/page.tsx's own "Help & Support" link already
 * passes when reached from inside the app. Renders nothing when that
 * param is absent or doesn't look like a tenant path (a pre-login
 * visit, or a generic external link to /support).
 */
export function RestartTourButton({ from }: { from?: string }) {
  const match = from?.match(/^\/t\/([^/]+)\//);
  if (!match) {
    return null;
  }
  const tenantSlug = match[1];

  return (
    <Link
      href={`/t/${tenantSlug}/sales?restartTour=1`}
      className="inline-block rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
    >
      Restart Product Tour
    </Link>
  );
}
