import Link from "next/link";

import { Logo } from "@/components/shared/logo";

const LEGAL_LINKS = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-of-service", label: "Terms of Service" },
  { href: "/account-deletion", label: "Delete My Account" },
  { href: "/support", label: "Support" },
];

/**
 * Hardening roadmap Phase 3.1 (docs/22-hardening-roadmap.md): public,
 * unauthenticated content pages (privacy/terms/support) -- (marketing)
 * was an empty, untracked route-group scaffold from very early in the
 * project (no layout, no pages) until this. Deliberately its own shell,
 * not reused from (auth) or (tenant): those are built for a signed-in-
 * or-signing-in flow at a constrained ~430px mobile width; this is
 * ordinary reading content that should work at any width, including a
 * regulator or Play Store reviewer opening it on a desktop.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center px-6 py-4">
          <Link href="/">
            <Logo />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</main>

      <footer className="border-t px-6 py-6 text-center text-xs text-muted-foreground">
        {/* Moved down from the header (Help & Support redesign): a
            three-word-link row next to the logo didn't fit a narrow
            mobile viewport without wrapping and overlapping the logo,
            and had become redundant with /support's own nav cards to
            these same three destinations anyway. The footer is the
            conventional place for this on a public content page, and a
            single centered line has no width pressure to compete with. */}
        <nav className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
        © {new Date().getFullYear()} SyncScore Ltd. JMS Sales App.
      </footer>
    </div>
  );
}
