import { notFound, redirect } from "next/navigation";

import { Logo } from "@/components/shared/logo";
import { TenantProvider } from "@/hooks/tenant-context";
import { getMyPermissions } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

/**
 * Resolves the :tenantSlug segment to a real tenant and enforces that the
 * signed-in user has an ACTIVE membership in it before rendering anything
 * underneath. This is app-layer defense in depth alongside RLS (see
 * docs/02-system-architecture.md) — RLS already prevents any data leakage
 * even if this check were skipped, but failing fast here gives a much
 * better UX than a page full of empty, RLS-filtered queries.
 *
 * Also where the signed-in user's permission set is resolved once
 * (getMyPermissions, backed by the same SQL function RLS policies use —
 * see docs/06-roles-permissions.md) and handed to TenantProvider so
 * usePermission()/useTenant() work in every client component underneath.
 *
 * The header (logo) lives here since it's constant across every
 * dashboard route; the persistent bottom nav lives one level down in
 * (dashboard)/layout.tsx, since /t/[tenantSlug] itself is never
 * rendered directly (it redirects into /sales — see page.tsx).
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

  const permissions = await getMyPermissions(tenant.id);

  return (
    <TenantProvider
      value={{
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        permissions,
      }}
    >
      <div className="flex min-h-screen w-full justify-center bg-muted/30">
        {/* id + contain-layout: on a wide (desktop) viewport this is the
            ~430px mobile shell, but a portaled Sheet/Dialog's `fixed`
            positioning is normally relative to the whole browser
            viewport, not this column -- `contain: layout` makes this div
            a containing block for fixed/absolute descendants too (see
            components/ui/{sheet,dialog}.tsx, which portal into
            #app-shell instead of <body> for exactly this reason), so a
            bottom sheet or centered dialog stays within the mobile
            column on desktop instead of spanning/centering on the full
            browser window. */}
        <div id="app-shell" className="relative flex w-full max-w-[430px] flex-col contain-layout bg-background">
          <div className="border-b px-6 py-4">
            <Logo />
          </div>
          {children}
        </div>
      </div>
    </TenantProvider>
  );
}
