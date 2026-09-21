/**
 * The public Customer Orders storefront's own shell -- no auth check
 * at all (the absence of a getCurrentUser()/redirect call is what
 * makes a route public in this codebase; middleware has no allow-list
 * to edit, see lib/supabase/middleware.ts's own behavior). Deliberately
 * its own route group, not reused from (marketing) (full-width reading
 * content, wrong shape for a storefront) or (tenant)/(auth) (built for
 * a signed-in-or-signing-in flow, and (tenant)'s #app-shell carries
 * `contain: layout`/nav machinery this page has no use for). A narrow,
 * centered mobile-first column, matching the tenant app's own visual
 * language without any of its authenticated chrome.
 */
export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col bg-background">
      {children}
      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">Powered by JMS Sales App</footer>
    </div>
  );
}
