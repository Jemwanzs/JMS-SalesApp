import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { MapPin } from "lucide-react";

import { AnniversaryCelebrationDialog } from "@/features/sales/components/anniversary-celebration-dialog";
import { OpenBusinessDayButton } from "@/features/sales/components/open-business-day-button";
import { ProductGrid } from "@/features/sales/components/product-grid";
import { ProductGridSkeleton } from "@/features/sales/components/product-grid-skeleton";
import { ReopenBusinessDayDialog } from "@/features/sales/components/reopen-business-day-dialog";
import { SalesVisibilityBadge } from "@/features/sales/components/sales-visibility-badge";
import { Badge } from "@/components/ui/badge";
import { AnalyticsService } from "@/services/AnalyticsService";
import { AnniversaryService } from "@/services/AnniversaryService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { ProductService } from "@/services/ProductService";
import { TenantService } from "@/services/TenantService";
import { LOCALE_BCP47, type SupportedLocale } from "@/lib/i18n/config";
import { can } from "@/lib/permissions/can";
import { todayString, trailingDaysRange } from "@/lib/utils/date-ranges";
import { rankProducts } from "@/lib/utils/product-ranking";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Sales | JMS Sales App",
};

/**
 * Capture Sales is the golden-path landing screen (spec S13). Phase 2b/
 * 2d make this real: a business day must be open before any sale can be
 * recorded (docs/09-business-day-engine.md), and the product grid +
 * record-sale sheet are the actual capture flow, not a placeholder.
 *
 * "reopened" (Phase 2h) is treated the same as "open" for capture
 * purposes -- it auto-relocks to "closed" once its window expires (see
 * BusinessDayService.getTodayBusinessDay's lazy check), so by the time
 * this page ever sees status "reopened" it's still genuinely within
 * that window.
 */
export default async function SalesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  // getUser() and the tenant lookup are independent (the latter only
  // needs tenantSlug from the URL) -- run them together rather than
  // waiting on getUser() first for no reason. getCurrentUser() also
  // reuses the layout's own already-resolved call instead of hitting
  // Supabase Auth's network endpoint a second time for this, the first
  // page rendered after every login.
  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  // The tenant layout above already redirects/notFounds on these same
  // conditions, but its redirect() isn't guaranteed to short-circuit
  // this page's own async body first -- Server Components layouts and
  // their nested pages can execute concurrently, so an unauthenticated
  // request could otherwise reach `tenant.id` below with `tenant` still
  // null (RLS-filtered) and throw instead of cleanly redirecting.
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  // profile and activeLocationId are likewise independent of each other
  // -- one needs user.id, the other tenant.id, neither needs the
  // other's result.
  const [{ data: profile }, activeLocationId] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    resolveActiveLocationId(supabase, tenant.id),
  ]);

  // Multi-Branch User Access Phase 5. No active_branch_sessions row for
  // this session -- normally impossible (sign-in always writes one
  // before landing here), but two real cases land here:
  //
  // 1. A session that authenticated before Phase 4/5 shipped. Re-running
  //    the same resolution /select-branch itself does self-heals it.
  // 2. A platform admin impersonating this tenant (Access Workspace) --
  //    they hold no real tenant_membership/branch assignment here at
  //    all, so resolveUserBranches (and therefore /select-branch) can
  //    never resolve anything for them either. Support needs to see the
  //    workspace as it actually is, not be forced through a branch
  //    picker they have no assignment to answer -- same "must still be
  //    able to open a deactivated tenant to investigate it" carve-out
  //    this app already makes elsewhere (app/(tenant)/t/[tenantSlug]/
  //    layout.tsx). Falls back to the tenant's first location, same
  //    resolution this page used before Phase 5, tenant-wide RLS bypass
  //    for impersonation handled in migration 0051.
  let location: { id: string };
  if (activeLocationId) {
    location = { id: activeLocationId };
  } else if (await new PlatformAdminService(createServiceRoleClient()).getActiveImpersonation(user.id, tenant.id)) {
    const { data: firstLocation } = await supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();
    location = { id: firstLocation!.id };
  } else {
    redirect(`/select-branch`);
  }

  const businessDayService = new BusinessDayService(supabase);
  const t = await getTranslations("Sales");
  // Display-facing only -- the "en-CA" ISO-date-key call at line ~101
  // below is a different thing entirely (business-day key generation,
  // not display) and must stay locale-independent, see that line's own
  // comment.
  const locale = (await getLocale()) as SupportedLocale;
  const bcp47 = LOCALE_BCP47[locale];

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString(bcp47, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // None of these seven depend on each other -- businessDay/todayRow/
  // activeLocation only need location.id, the rest only need tenant.id
  // -- so they can all run in one round trip instead of blocking each
  // other. `businessDay` (live-only) still gates canCapture exactly as
  // before; `todayRow` is the new, separate "does today's own row exist
  // regardless of status" lookup -- see BusinessDayService.
  // getTodayBusinessDayRow's own header comment for why businessDay
  // alone could never detect "closed."
  const [businessDay, todayRow, canOpenDay, canReopenDay, activeWish, activeLocation, hashedOpenPasscode] =
    await Promise.all([
      businessDayService.getTodayBusinessDay(tenant.id, location.id),
      businessDayService.getTodayBusinessDayRow(tenant.id, location.id),
      can("business_day.open", { tenantId: tenant.id }),
      can("business_day.reopen", { tenantId: tenant.id }),
      new AnniversaryService(supabase).getActiveWish(tenant.id).catch(() => null),
      supabase.from("locations").select("name").eq("id", location.id).maybeSingle(),
      // Gated on whether a passcode has been CREATED at all (matches
      // open-business-day.ts's own check), not require_download_passcode
      // -- that toggle only governs downloads, see DownloadSecurityCard.
      new TenantService(supabase).getSetting<string>(tenant.id, "hashed_download_passcode"),
    ]);
  // Business + branch identity always shows here now, single-branch
  // tenants included -- this is the golden-path landing screen (spec
  // S13) where sales get captured, and being certain which business/
  // branch a session is in matters just as much for a single-branch
  // tenant as a multi-branch one.
  const activeBranchName = activeLocation.data?.name ?? null;

  const canCapture = businessDay?.status === "open" || businessDay?.status === "reopened";

  // The tenant layout shell already shows a small, low-key banner for any
  // wish sent in the last 7 days -- this is the louder, one-day-only
  // celebration specifically on the landing page, active only on the
  // actual anniversary day itself (tenant-timezone-scoped), not the whole
  // trailing week. Every member of this tenant sees it (not gated by
  // role) since it's a whole-business celebration, not an admin tool;
  // getActiveWish is already tenant_id-scoped and RLS-gated, so it can
  // never surface another tenant's wish here.
  const todayDateKey = todayString(tenant.timezone);
  const wishSentToday =
    activeWish?.sentAt != null &&
    new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone }).format(new Date(activeWish.sentAt)) === todayDateKey;

  return (
    <div className="flex flex-1 flex-col p-6">
      {wishSentToday && activeWish && (
        <AnniversaryCelebrationDialog wishId={`${activeWish.id}-${todayDateKey}`} message={activeWish.message} />
      )}
      {/* Business + branch identity: the first thing on the golden-path
          screen where sales actually get captured, so it's never
          ambiguous which business/branch a session is working in --
          deliberately more prominent than a small badge, and shown for
          every tenant (not just multi-branch ones). */}
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-base font-semibold">{tenant.name}</p>
        {activeBranchName && (
          <Badge variant="outline" className="shrink-0 gap-1">
            <MapPin className="h-3 w-3" />
            {activeBranchName}
          </Badge>
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">{today}</p>
      <h1 className="mt-1 text-xl font-semibold">{t("greeting", { name: firstName })}</h1>

      <div className="mt-6">
        <SalesVisibilityBadge />
      </div>

      {businessDay?.status === "reopened" && businessDay.reopenExpiresAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("reopenedUntil", {
            time: new Date(businessDay.reopenExpiresAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          })}
        </p>
      )}

      {canCapture && businessDay ? (
        <Suspense fallback={<ProductGridSkeleton />}>
          <SalesCaptureBody
            tenantId={tenant.id}
            tenantSlug={tenantSlug}
            timezone={tenant.timezone}
            locationId={location.id}
            businessDayId={businessDay.id}
            supabase={supabase}
          />
        </Suspense>
      ) : (
        <div className="mt-8 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
          <p className="text-lg font-medium">
            {todayRow?.status === "closed" ? t("businessDayClosed") : t("businessDayNotOpen")}
          </p>
          <p className="mt-2 max-w-[28ch] text-sm text-muted-foreground">
            {todayRow?.status === "closed"
              ? canReopenDay
                ? t("reopenToAddMissedSale")
                : t("askAdminToReopen")
              : canOpenDay
                ? t("openToStartRecording")
                : t("askAdminToOpen")}
          </p>
          <div className="mt-4 w-full max-w-[240px]">
            {todayRow?.status === "closed"
              ? canReopenDay && (
                  <ReopenBusinessDayDialog
                    businessDayId={todayRow.id}
                    tenantId={tenant.id}
                    tenantSlug={tenantSlug}
                  />
                )
              : canOpenDay && (
                  <OpenBusinessDayButton
                    tenantId={tenant.id}
                    tenantSlug={tenantSlug}
                    locationId={location.id}
                    requiresPasscode={!!hashedOpenPasscode}
                  />
                )}
          </div>
        </div>
      )}
    </div>
  );
}

async function SalesCaptureBody({
  tenantId,
  tenantSlug,
  timezone,
  locationId,
  businessDayId,
  supabase,
}: {
  tenantId: string;
  tenantSlug: string;
  timezone: string;
  locationId: string;
  businessDayId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const productService = new ProductService(supabase);
  const tenantService = new TenantService(supabase);

  const [products, settings] = await Promise.all([
    productService.listActive(tenantId),
    tenantService.getSettings(tenantId, [
      "product_ranking_enabled",
      "show_daily_sales_volume",
      "show_product_price_on_landing",
      "quantity_enabled",
      "notes_field_enabled",
    ]),
  ]);

  const rankingEnabled = (settings.product_ranking_enabled as boolean | undefined) ?? true;
  const showDailyVolume = (settings.show_daily_sales_volume as boolean | undefined) ?? false;
  const showProductPrice = (settings.show_product_price_on_landing as boolean | undefined) ?? true;
  const quantityEnabled = (settings.quantity_enabled as boolean | undefined) ?? true;
  const notesEnabled = (settings.notes_field_enabled as boolean | undefined) ?? true;

  let rankedProducts: ReturnType<typeof rankProducts> = products.map((p) => ({
    ...p,
    tier: null,
    rankingRevenue: 0,
  }));
  let todayRevenue = new Map<string, number>();

  if (rankingEnabled || showDailyVolume) {
    // Business Day Rollover: the leaderboard's "today" is the effective
    // BUSINESS date, not the raw calendar date -- otherwise Gold/Silver/
    // Bronze tiering (and "today's sales" volume) would blank out the
    // moment the calendar rolls over mid-extension, even though the
    // business day is still open and accumulating. See BusinessDayService's
    // own header comments (migration 0055).
    const today = (await new BusinessDayService(supabase).getEffectiveBusinessDate(tenantId, locationId)).date;
    const analyticsService = new AnalyticsService(supabase);
    const { todayRevenue: todayMap } = await analyticsService.getProductRevenueTotals(
      tenantId,
      trailingDaysRange(30, timezone),
      today
    );
    todayRevenue = todayMap;
    if (rankingEnabled) {
      if (todayMap.size > 0) {
        // Today's tally so far.
        rankedProducts = rankProducts(products, todayMap);
      } else {
        // Nothing recorded yet today -- fall back to whichever PAST day
        // most recently had any real sales, however long ago that was
        // (could be yesterday, could be a week back after a closure).
        // Not the 30-day window above: that's a fixed lookback, this
        // needs to search back as far as it takes. See rankProducts' own
        // header comment and getMostRecentActiveSalesDate's.
        const lastActiveDate = await analyticsService.getMostRecentActiveSalesDate(tenantId, today);
        if (lastActiveDate) {
          const { todayRevenue: lastActiveDayRevenue } = await analyticsService.getProductRevenueTotals(
            tenantId,
            { from: lastActiveDate, to: lastActiveDate },
            lastActiveDate
          );
          rankedProducts = rankProducts(products, lastActiveDayRevenue);
        }
        // else: this tenant has never recorded a sale -- rankedProducts
        // stays at its no-tiers default, correctly.
      }
    }
  }

  return (
    <div className="-mx-6 mt-4 flex flex-1 flex-col">
      <ProductGrid
        products={rankedProducts}
        showDailyVolume={showDailyVolume}
        todayRevenue={todayRevenue}
        showProductPrice={showProductPrice}
        quantityEnabled={quantityEnabled}
        notesEnabled={notesEnabled}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        locationId={locationId}
        businessDayId={businessDayId}
      />
    </div>
  );
}
