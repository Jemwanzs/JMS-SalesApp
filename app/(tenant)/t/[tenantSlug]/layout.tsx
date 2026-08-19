import { notFound, redirect } from "next/navigation";

import { ImpersonationBanner } from "@/components/shared/impersonation-banner";
import { Logo } from "@/components/shared/logo";
import { TenantProvider } from "@/hooks/tenant-context";
import { getMyPermissions } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AnniversaryService } from "@/services/AnniversaryService";
import { PlatformAdminService } from "@/services/PlatformAdminService";

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
 * Phase 7b: a platform admin has no real tenant_memberships row, so the
 * normal membership check fails for them -- the fallback checks for an
 * active impersonation_sessions row (migration 0024) before giving up
 * and redirecting to /no-tenant. getMyPermissions() then resolves
 * correctly for them too, automatically, since the SAME SQL function
 * this calls was extended to key off the impersonated target's profile
 * id in that migration -- nothing here special-cases permission
 * resolution itself, only whether to redirect.
 *
 * The header (logo) lives here since it's constant across every
 * dashboard route; the persistent bottom nav lives one level down in
 * (dashboard)/layout.tsx, since /t/[tenantSlug] itself is never
 * rendered directly (it redirects into /sales — see page.tsx).
 *
 * Phase 7d: a recently-sent anniversary wish (AnniversaryService.
 * getActiveWish, scoped to the last 7 days so it doesn't linger for the
 * rest of the year) renders as a small banner here too, for the same
 * "one shared spot, every dashboard page" reason the impersonation
 * banner does — best-effort (`.catch(() => null)`), since a wish
 * message failing to load must never block the tenant shell itself.
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

  // A platform admin has no real tenant_memberships row of their own --
  // this fallback only runs on that (rare, admin-only) path, so ordinary
  // members never pay for an extra query. migration 0024's SQL functions
  // (has_permission/is_tenant_member/get_my_permissions) independently
  // resolve the exact same fact for every actual data query underneath;
  // this is purely so the layout knows whether to render the SUPPORT
  // MODE banner instead of redirecting to /no-tenant.
  let impersonation: { sessionId: string; targetProfileName: string | null; expiresAt: string } | null = null;
  if (!membership || membership.status !== "active") {
    const active = await new PlatformAdminService(createServiceRoleClient()).getActiveImpersonation(user.id, tenant.id);
    if (active) {
      impersonation = {
        sessionId: active.sessionId,
        targetProfileName: active.targetProfileName,
        expiresAt: active.expiresAt,
      };
    } else {
      redirect("/no-tenant");
    }
  }

  const permissions = await getMyPermissions(tenant.id);
  const activeWish = await new AnniversaryService(supabase).getActiveWish(tenant.id).catch(() => null);

  return (
    <TenantProvider
      value={{
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        permissions,
        impersonation,
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
          {impersonation && <ImpersonationBanner tenantId={tenant.id} impersonation={impersonation} />}
          <div className="border-b px-6 py-4">
            <Logo />
          </div>
          {activeWish && (
            <div className="border-b bg-amber-50 px-6 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {activeWish.message}
            </div>
          )}
          {children}
        </div>
      </div>
    </TenantProvider>
  );
}
