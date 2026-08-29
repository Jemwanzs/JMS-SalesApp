import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";

import { AdminBypassToast } from "@/components/shared/admin-bypass-toast";
import { ImpersonationBanner } from "@/components/shared/impersonation-banner";
import { Logo } from "@/components/shared/logo";
import { SubscriptionBanner } from "@/components/shared/subscription-banner";
import { TenantProvider } from "@/hooks/tenant-context";
import { resolveColorPalette } from "@/lib/branding/color-palette";
import { resolvePreferredFont } from "@/lib/branding/preferred-font";
import { getInventoryEntitlement } from "@/lib/inventory/entitlement";
import { getMyPermissions } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { AnniversaryService } from "@/services/AnniversaryService";
import { BillingService } from "@/services/BillingService";
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
 *
 * Product Enhancements #2: SubscriptionBanner surfaces trial-days-left/
 * renewal-approaching/overdue/expired using the same subscription row
 * BillingStatusCard reads on the dedicated /billing page — fetched here
 * via the service-role client (not the RLS-respecting one) since
 * subscriptions_select RLS only grants the billing owner or a
 * settings.manage holder read access, but this banner is meant for
 * every member.
 *
 * Product Enhancements #3/#4: `inventoryEnabled` (lib/inventory/
 * entitlement.ts) is resolved once here too and hydrated into
 * TenantContext, the same "compute once, reuse everywhere" pattern as
 * `permissions` — components/shared/bottom-nav.tsx reads it to decide
 * whether the Stock tab renders.
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

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const tenant = await getTenantBySlug(supabase, tenantSlug);

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
  let isRealMember = false;
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
  } else {
    isRealMember = true;
  }

  // UX fast-path only -- migration 0031's has_permission() redefinition
  // is the REAL enforcement (a Server Action is directly invokable
  // regardless of what this layout redirects to). Deliberately does NOT
  // apply to the impersonation branch above: Support must still be able
  // to open a deactivated tenant's workspace to investigate it.
  if (isRealMember && tenant.status === "deactivated") {
    redirect("/tenant-deactivated");
  }

  // Service-role, not the RLS-respecting client -- subscriptions_select
  // RLS only grants the billing owner or a settings.manage holder read
  // access, but the trial/renewal banner is meant for every member (a
  // lapsed subscription restricts everyone, not just the owner), same
  // "cross-cutting, needed-for-everyone" reasoning as the impersonation
  // check above.
  // User & Tenant Branding Personalization: resolved here (not on <html>
  // in app/layout.tsx -- see that file's own header comment) since this
  // is the first per-request-dynamic layout a signed-in user's requests
  // actually reach.
  const [permissions, activeWish, subscription, inventoryEntitlement, preferredFont, colorPalette] = await Promise.all([
    getMyPermissions(tenant.id),
    new AnniversaryService(supabase).getActiveWish(tenant.id).catch(() => null),
    new BillingService(createServiceRoleClient()).getSubscription(tenant.id).catch(() => null),
    getInventoryEntitlement(tenant.id).catch(() => ({ enabled: false, status: null })),
    resolvePreferredFont(supabase, user.id),
    resolveColorPalette(supabase, user.id),
  ]);

  return (
    <TenantProvider
      value={{
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        permissions,
        impersonation,
        inventoryEnabled: inventoryEntitlement.enabled,
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
        <div
          id="app-shell"
          data-font={preferredFont}
          data-palette={colorPalette}
          className="relative flex w-full max-w-[430px] flex-col contain-layout bg-background"
        >
          <Suspense fallback={null}>
            <AdminBypassToast />
          </Suspense>
          {impersonation && <ImpersonationBanner tenantId={tenant.id} impersonation={impersonation} />}
          <SubscriptionBanner tenantId={tenant.id} tenantSlug={tenant.slug} subscription={subscription} />
          <div className="flex items-center justify-between border-b px-6 py-4">
            <Logo />
            {/* User & Tenant Branding Personalization: icon only, no
                business name next to it, per the explicit requirement --
                stays completely absent (not an empty placeholder) when
                the tenant hasn't uploaded one, exactly as this area
                looked before this feature existed. Plain <img>, not
                next/image -- the upload accepts SVG (features/workspace/
                components/logo-upload.tsx), and next/image's optimizer
                refuses SVGs without extra dangerouslyAllowSVG config; a
                small fixed-size header icon gets no real benefit from
                Next's responsive-image machinery anyway. object-contain
                (never object-cover) so a logo's own aspect ratio is
                always preserved, never stretched or cropped. */}
            {tenant.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logo_url} alt="" className="h-8 max-w-[120px] object-contain" />
            )}
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
