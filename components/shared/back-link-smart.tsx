"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * Help & Support redesign: unlike BackLink (a plain, fixed-destination
 * link used when a page always has exactly one parent), /support is
 * reachable from several places -- the tenant More menu today, possibly
 * a signed-out context later -- so "return to the exact screen" can't
 * be a single hardcoded href.
 *
 * Prefers an explicit `?from=` query param (passed by whoever links
 * here, e.g. more/page.tsx's Help & Support entry) over browser history
 * heuristics -- a real, reliable destination beats guessing from
 * document.referrer/history.length. Falls back to router.back() when
 * real history exists (the common "I clicked a link two seconds ago"
 * case), and only then to the caller's own fallbackHref (e.g. the
 * tenant's own dashboard) when neither is available -- someone opening
 * this URL directly, with no `from` and no in-app history at all.
 */
export function BackLinkSmart({ fallbackHref, fallbackLabel }: { fallbackHref: string; fallbackLabel: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from");

  const className =
    "mb-4 inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted";

  if (from) {
    return (
      <Link href={from} className={className}>
        <ChevronLeft className="h-4 w-4" />
        Back
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push(fallbackHref);
        }
      }}
      className={className}
    >
      <ChevronLeft className="h-4 w-4" />
      Back{fallbackLabel ? ` to ${fallbackLabel}` : ""}
    </button>
  );
}
