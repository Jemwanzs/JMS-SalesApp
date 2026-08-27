import Link from "next/link";

import { Logo } from "@/components/shared/logo";

const LEGAL_LINKS = [
  { href: "/privacy-policy", label: "Privacy Policy" },
  { href: "/terms-of-service", label: "Terms of Service" },
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
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-foreground">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</main>

      <footer className="border-t px-6 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} SyncScore Ltd. JMS Sales App.
      </footer>
    </div>
  );
}
