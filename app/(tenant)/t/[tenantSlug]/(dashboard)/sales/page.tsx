import type { Metadata } from "next";

import { AnniversaryCelebrationDialog } from "@/features/sales/components/anniversary-celebration-dialog";
import { OpenBusinessDayButton } from "@/features/sales/components/open-business-day-button";
import { ProductGrid } from "@/features/sales/components/product-grid";
import { ReopenBusinessDayDialog } from "@/features/sales/components/reopen-business-day-dialog";
import { SalesVisibilityBadge } from "@/features/sales/components/sales-visibility-badge";
import { AnalyticsService } from "@/services/AnalyticsService";
import { AnniversaryService } from "@/services/AnniversaryService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { ProductService } from "@/services/ProductService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { todayString, trailingDaysRange } from "@/lib/utils/date-ranges";
import { rankProducts } from "@/lib/utils/product-ranking";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

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
  const [user, { data: tenant }] = await Promise.all([
    getCurrentUser(),
    supabase.from("tenants").select("id, timezone").eq("slug", tenantSlug).single(),
  ]);

  // profile and locationRow are likewise independent of each other --
  // one needs user.id, the other tenant.id, neither needs the other's
  // result.
  const [{ data: profile }, { data: locationRow }] = await Promise.all([
    user
      ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", tenant!.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .single(),
  ]);
  const location = locationRow!;

  const businessDayService = new BusinessDayService(supabase);

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // None of these four depend on each other -- businessDay only needs
  // location.id, the rest only need tenant.id -- so they can all run in
  // one round trip instead of businessDay blocking the other three.
  const [businessDay, canOpenDay, canReopenDay, activeWish] = await Promise.all([
    businessDayService.getTodayBusinessDay(tenant!.id, location.id),
    can("business_day.open", { tenantId: tenant!.id }),
    can("business_day.reopen", { tenantId: tenant!.id }),
    new AnniversaryService(supabase).getActiveWish(tenant!.id).catch(() => null),
  ]);

  const canCapture = businessDay?.status === "open" || businessDay?.status === "reopened";

  // The tenant layout shell already shows a small, low-key banner for any
  // wish sent in the last 7 days -- this is the louder, one-day-only
  // celebration specifically on the landing page, active only on the
  // actual anniversary day itself (tenant-timezone-scoped), not the whole
  // trailing week. Every member of this tenant sees it (not gated by
  // role) since it's a whole-business celebration, not an admin tool;
  // getActiveWish is already tenant_id-scoped and RLS-gated, so it can
  // never surface another tenant's wish here.
  const todayDateKey = todayString(tenant!.timezone);
  const wishSentToday =
    activeWish?.sentAt != null &&
    new Intl.DateTimeFormat("en-CA", { timeZone: tenant!.timezone }).format(new Date(activeWish.sentAt)) === todayDateKey;

  return (
    <div className="flex flex-1 flex-col p-6">
      {wishSentToday && activeWish && (
        <AnniversaryCelebrationDialog wishId={`${activeWish.id}-${todayDateKey}`} message={activeWish.message} />
      )}
      <p className="text-sm text-muted-foreground">{today}</p>
      <h1 className="mt-1 text-xl font-semibold">Good day, {firstName}</h1>

      <div className="mt-6">
        <SalesVisibilityBadge />
      </div>

      {businessDay?.status === "reopened" && businessDay.reopenExpiresAt && (
        <p className="mt-2 text-xs text-muted-foreground">
          Reopened until{" "}
          {new Date(businessDay.reopenExpiresAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      )}

      {canCapture && businessDay ? (
        <SalesCaptureBody
          tenantId={tenant!.id}
          tenantSlug={tenantSlug}
          timezone={tenant!.timezone}
          locationId={location.id}
          businessDayId={businessDay.id}
          supabase={supabase}
        />
      ) : (
        <div className="mt-8 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
          <p className="text-lg font-medium">
            {businessDay?.status === "closed" ? "Business day is closed" : "Business day not open"}
          </p>
          <p className="mt-2 max-w-[28ch] text-sm text-muted-foreground">
            {businessDay?.status === "closed"
              ? canReopenDay
                ? "Reopen it to add a sale that was missed."
                : "Ask an administrator to reopen today's business day."
              : canOpenDay
                ? "Open the business day to start recording sales."
                : "Ask an administrator to open today's business day."}
          </p>
          <div className="mt-4 w-full max-w-[240px]">
            {businessDay?.status === "closed"
              ? canReopenDay && (
                  <ReopenBusinessDayDialog
                    businessDayId={businessDay.id}
                    tenantId={tenant!.id}
                    tenantSlug={tenantSlug}
                  />
                )
              : canOpenDay && (
                  <OpenBusinessDayButton
                    tenantId={tenant!.id}
                    tenantSlug={tenantSlug}
                    locationId={location.id}
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

  const [products, rankingEnabledSetting, showDailyVolumeSetting, showProductPriceSetting, quantityEnabledSetting] = await Promise.all([
    productService.listActive(tenantId),
    tenantService.getSetting<boolean>(tenantId, "product_ranking_enabled"),
    tenantService.getSetting<boolean>(tenantId, "show_daily_sales_volume"),
    tenantService.getSetting<boolean>(tenantId, "show_product_price_on_landing"),
    tenantService.getSetting<boolean>(tenantId, "quantity_enabled"),
  ]);

  const rankingEnabled = rankingEnabledSetting ?? true;
  const showDailyVolume = showDailyVolumeSetting ?? false;
  const showProductPrice = showProductPriceSetting ?? true;
  const quantityEnabled = quantityEnabledSetting ?? true;

  let rankedProducts: ReturnType<typeof rankProducts> = products.map((p) => ({
    ...p,
    tier: null,
    thirtyDayRevenue: 0,
  }));
  let todayRevenue = new Map<string, number>();

  if (rankingEnabled || showDailyVolume) {
    const today = todayString(timezone);
    const { windowRevenue, todayRevenue: todayMap } = await new AnalyticsService(supabase).getProductRevenueTotals(
      tenantId,
      trailingDaysRange(30, timezone),
      today
    );
    todayRevenue = todayMap;
    if (rankingEnabled) {
      rankedProducts = rankProducts(products, windowRevenue);
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
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        locationId={locationId}
        businessDayId={businessDayId}
      />
    </div>
  );
}
