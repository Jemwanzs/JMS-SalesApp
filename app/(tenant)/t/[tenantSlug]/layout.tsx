import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { AdminBypassToast } from "@/components/shared/admin-bypass-toast";
import { ImpersonationBanner } from "@/components/shared/impersonation-banner";
import { Logo } from "@/components/shared/logo";
import { SubscriptionBanner } from "@/components/shared/subscription-banner";
import { TenantLogoViewer } from "@/components/shared/tenant-logo-viewer";
import { TourOverlay } from "@/features/onboarding/components/tour-overlay";
import { TenantProvider } from "@/hooks/tenant-context";
import { TourProvider } from "@/hooks/tour-context";
import { resolveColorPalette } from "@/lib/branding/color-palette";
import { resolvePreferredFont } from "@/lib/branding/preferred-font";
import { RTL_LOCALES, type SupportedLocale } from "@/lib/i18n/config";
import { getInventoryEntitlement } from "@/lib/inventory/entitlement";
import { getMyPermissions } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { resolveTourCompleted } from "@/lib/tenant/resolve-tour-state";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { AnniversaryService } from "@/services/AnniversaryService";
import { BillingService } from "@/services/BillingService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { TenantService } from "@/services/TenantService";

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
 * whether the Stock tab renders. `historyEnabled`/`analyticsEnabled`/
 * `reportsEnabled` (Settings -> "Reporting Tabs") follow the identical
 * pattern for the three other core nav tabs a tenant admin can choose
 * to hide.
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

  // getTenantBySlug only depends on tenantSlug (from the URL) and a
  // cookie-based client -- no dependency on the signed-in user, so
  // there's no reason to wait on getCurrentUser() first. Both are
  // cache()-wrapped, so sales/page.tsx's later identical pair reuses
  // these exact results instead of re-fetching.
  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  if (!user) {
    redirect("/login");
  }

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
  // access. Fetched for every member here (cheap, request-scoped), but
  // Product Enhancements (Subscription Due) now restricts who actually
  // SEES the resulting banner to Tenant Admins/the billing owner only
  // (isBillingAdmin, below) -- invited employees must never see
  // subscription/billing alerts at all, not even a softened version.
  // User & Tenant Branding Personalization: resolved here (not on <html>
  // in app/layout.tsx -- see that file's own header comment) since this
  // is the first per-request-dynamic layout a signed-in user's requests
  // actually reach.
  const [
    permissions,
    activeWish,
    subscription,
    inventoryEntitlement,
    preferredFont,
    colorPalette,
    locale,
    messages,
    activeLocationId,
    hasAnyLocation,
    tourCompletedAt,
    tabsVisibility,
  ] = await Promise.all([
    getMyPermissions(tenant.id),
    new AnniversaryService(supabase).getActiveWish(tenant.id).catch(() => null),
    new BillingService(createServiceRoleClient()).getSubscription(tenant.id).catch(() => null),
    getInventoryEntitlement(tenant.id).catch(() => ({ enabled: false, status: null })),
    resolvePreferredFont(supabase, user.id),
    resolveColorPalette(supabase, user.id),
    // My Preferences (Language): getLocale()/getMessages() both resolve
    // via i18n/request.ts, which independently re-reads
    // profiles.default_locale for this same user -- one extra DB read,
    // not duplicated resolution logic (see that file's own header
    // comment for why requestLocale/[locale]-segment routing is
    // deliberately unused here).
    getLocale(),
    getMessages(),
    // Multi-Branch User Access Phase 5 follow-up: resolved here (not
    // just sales/page.tsx) so the self-heal below protects every
    // dashboard route -- analytics/sales-history/reports/stock, not
    // only the golden path. Both run unconditionally alongside
    // everything else above (cheap, indexed) rather than only after
    // discovering they're needed, to keep this one Promise.all instead
    // of a second sequential round trip.
    resolveActiveLocationId(supabase, tenant.id),
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).then(({ count }) => !!count),
    // Guided Onboarding Tour: whether to auto-launch it. Resolved
    // unconditionally alongside everything else above -- cheap, and
    // keeps this one Promise.all instead of a second round trip.
    resolveTourCompleted(supabase, user.id),
    // Reporting Tabs visibility (Settings): default ON for all three --
    // a missing key means "not configured," same "no row = not
    // configured" contract getSettings documents, not "off."
    new TenantService(supabase).getSettings(tenant.id, ["history_enabled", "analytics_enabled", "reports_enabled"]),
  ]);

  // Never auto-launches for impersonation (Support isn't a new user)
  // or while onboarding is still pending (nothing to tour yet) --
  // reuses isRealMember/hasAnyLocation, already resolved above for the
  // /select-branch self-heal check.
  const tourCompleted = !isRealMember || !hasAnyLocation || tourCompletedAt;
  const isRtl = RTL_LOCALES.has(locale as SupportedLocale);

  // A real member with no active_branch_sessions row for THIS session
  // (a session that authenticated before Phase 4/5 shipped -- see
  // migration 0051's own header comment) gets sent through
  // /select-branch to self-heal, same redirect sales/page.tsx already
  // does defensively for itself. Skipped while the tenant has no
  // location at all yet (onboarding still pending -- nothing to
  // resolve) and for impersonation (Support has no branch assignment
  // to resolve here at all; migration 0051's RLS bypass is what keeps
  // it working instead).
  if (isRealMember && hasAnyLocation && !activeLocationId) {
    redirect("/select-branch");
  }

  // Product Enhancements (Subscription Due / Overdue Read-Only Mode):
  // "Invited employees and ordinary users should never see subscription,
  // renewal, payment, or billing alerts" -- same admin check /billing's
  // own page gate already uses (tenant.billing_owner_profile_id ===
  // user.id || settings.manage), reusing the permissions array already
  // resolved above instead of a second can() query.
  const isBillingAdmin =
    tenant.billing_owner_profile_id === user.id || permissions.some((p) => p.permissionKey === "settings.manage");

  return (
    <TenantProvider
      value={{
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        permissions,
        impersonation,
        inventoryEnabled: inventoryEntitlement.enabled,
        historyEnabled: (tabsVisibility.history_enabled as boolean | undefined) ?? true,
        analyticsEnabled: (tabsVisibility.analytics_enabled as boolean | undefined) ?? true,
        reportsEnabled: (tabsVisibility.reports_enabled as boolean | undefined) ?? true,
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
          dir={isRtl ? "rtl" : "ltr"}
          // font-sans here is load-bearing, not decorative: app/globals.css's
          // html { @apply font-sans; } is the ONLY other font-family
          // declaration in the app, and CSS inheritance carries an
          // already-COMPUTED font-family value down the tree, not a live
          // var() reference -- so without re-declaring font-family HERE,
          // every descendant that doesn't itself apply .font-sans/.font-heading
          // (i.e. almost everything except a few Dialog/Sheet/Card titles)
          // would keep inheriting <html>'s permanently-Outfit value
          // regardless of data-font above. This one declaration re-resolves
          // --font-sans fresh within this [data-font]-scoped subtree, and
          // normal inheritance then correctly carries the chosen font to
          // every descendant -- headings, tables, forms, buttons, modals
          // (portaled into #app-shell, see the comment below), everything.
          className="relative flex w-full max-w-[430px] flex-col contain-layout bg-background font-sans"
        >
          {/* My Preferences (Language): NextIntlClientProvider wraps
              children here, not app/layout.tsx's <html> -- same reasoning
              as data-font/data-palette above (root layout stays fully
              static). dir="rtl" above correctly flips text direction and
              native form-control mirroring for Arabic; it does NOT
              auto-mirror bespoke flex/grid layouts built with physical
              Tailwind utilities (pl-4, text-left, etc.) -- a follow-up
              RTL-audit pass, not this one, per docs/22-hardening-roadmap.md's
              i18n advisory. */}
          <NextIntlClientProvider locale={locale} messages={messages}>
            <Suspense fallback={null}>
              <AdminBypassToast />
            </Suspense>
            {impersonation && <ImpersonationBanner tenantId={tenant.id} impersonation={impersonation} />}
            <SubscriptionBanner
              tenantId={tenant.id}
              tenantSlug={tenant.slug}
              subscription={isBillingAdmin ? subscription : null}
            />
            <div className="flex items-center justify-between border-b px-6 py-4">
              <Logo />
              {/* User & Tenant Branding Personalization: icon only, no
                  business name next to it, per the explicit requirement --
                  stays completely absent (not an empty placeholder) when
                  the tenant hasn't uploaded one, exactly as this area
                  looked before this feature existed. Rounded framing +
                  tap-to-view-full-size (TenantLogoViewer) -- see that
                  component's own header comment for why it's still a
                  plain <img>, not next/image. */}
              {tenant.logo_url && <TenantLogoViewer logoUrl={tenant.logo_url} />}
            </div>
            {activeWish && (
              <div className="border-b bg-amber-50 px-6 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {activeWish.message}
              </div>
            )}
            <Suspense fallback={children}>
              <TourProvider tenantSlug={tenant.slug} tourCompleted={tourCompleted}>
                {children}
                <TourOverlay />
              </TourProvider>
            </Suspense>
          </NextIntlClientProvider>
        </div>
      </div>
    </TenantProvider>
  );
}
