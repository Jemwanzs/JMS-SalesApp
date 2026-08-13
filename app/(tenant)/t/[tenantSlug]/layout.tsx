import { notFound, redirect } from "next/navigation";

import { Logo } from "@/components/shared/logo";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolves the :tenantSlug segment to a real tenant and enforces that the
 * signed-in user has an ACTIVE membership in it before rendering anything
 * underneath. This is app-layer defense in depth alongside RLS (see
 * docs/02-system-architecture.md) — RLS already prevents any data leakage
 * even if this check were skipped, but failing fast here gives a much
 * better UX than a page full of empty, RLS-filtered queries.
 *
 * This is a minimal placeholder shell (no bottom nav, no PWA chrome yet —
 * that's Phase 1f) so Phase 1c's sign-up -> tenant -> login loop has
 * somewhere real to land and be verified end-to-end.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, slug")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (!tenant) {
    notFound();
  }

  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("status")
    .eq("tenant_id", tenant.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (!membership || membership.status !== "active") {
    redirect("/no-tenant");
  }

  return (
    <div className="flex min-h-screen w-full justify-center bg-muted/30">
      <div className="flex w-full max-w-[430px] flex-col bg-background">
        <div className="border-b px-6 py-4">
          <Logo />
        </div>
        {children}
      </div>
    </div>
  );
}
