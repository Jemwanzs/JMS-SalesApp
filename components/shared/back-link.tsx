import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The tenant shell (app/(tenant)/t/[tenantSlug]/(dashboard)/layout.tsx)
 * has no header/back affordance at all -- every page reached through the
 * More menu previously relied on the browser/OS back gesture to return.
 * This is a small, page-level "back to X" link, not a global header, so
 * each page picks the specific parent it actually wants (More, or a
 * specific list for a drill-down like an import's detail screen).
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      {label}
    </Link>
  );
}
