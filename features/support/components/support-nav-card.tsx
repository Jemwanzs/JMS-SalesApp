import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Help & Support redesign: a modern mobile-menu-style card (icon
 * circle, title, short description, chevron, comfortable tap target)
 * replacing the plain text links the marketing header's own nav already
 * offers for the same three destinations -- this is the in-content,
 * app-like version, not a duplicate of that header nav (which stays,
 * per "the application's normal navigation bar should remain
 * available"). Plain <a> (not next/link) when `href` starts with "#" --
 * an in-page anchor scroll, not a route change.
 */
export function SupportNavCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  const content = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block truncate text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </>
  );

  const className =
    "flex items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-muted active:bg-muted";

  if (href.startsWith("#")) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
