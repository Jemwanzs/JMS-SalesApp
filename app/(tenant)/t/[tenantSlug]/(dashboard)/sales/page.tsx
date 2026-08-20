import type { Metadata } from "next";

import { OpenBusinessDayButton } from "@/features/sales/components/open-business-day-button";
import { ProductGrid } from "@/features/sales/components/product-grid";
import { ReopenBusinessDayDialog } from "@/features/sales/components/reopen-business-day-dialog";
import { SalesVisibilityBadge } from "@/features/sales/components/sales-visibility-badge";
import { AnalyticsService } from "@/services/AnalyticsService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { ProductService } from "@/services/ProductService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { todayString, trailingDaysRange } from "@/lib/utils/date-ranges";
import { rankProducts } from "@/lib/utils/product-ranking";
import { createClient } from "@/lib/supabase/server";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
    : { data: null };

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, timezone")
    .eq("slug", tenantSlug)
    .single();

  const { data: locationRow } = await supabase
    .from("locations")
    .select("id")
    .eq("tenant_id", tenant!.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  const location = locationRow!;

  const businessDayService = new BusinessDayService(supabase);
  const businessDay = await businessDayService.getTodayBusinessDay(tenant!.id, location.id);

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const canCapture = businessDay?.status === "open" || businessDay?.status === "reopened";
  const canOpenDay = await can("business_day.open", { tenantId: tenant!.id });
  const canReopenDay = await can("business_day.reopen", { tenantId: tenant!.id });

  return (
    <div className="flex flex-1 flex-col p-6">
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

  const [products, rankingEnabledSetting, showDailyVolumeSetting, quantityEnabledSetting] = await Promise.all([
    productService.listActive(tenantId),
    tenantService.getSetting<boolean>(tenantId, "product_ranking_enabled"),
    tenantService.getSetting<boolean>(tenantId, "show_daily_sales_volume"),
    tenantService.getSetting<boolean>(tenantId, "quantity_enabled"),
  ]);

  const rankingEnabled = rankingEnabledSetting ?? true;
  const showDailyVolume = showDailyVolumeSetting ?? false;
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
        quantityEnabled={quantityEnabled}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        locationId={locationId}
        businessDayId={businessDayId}
      />
    </div>
  );
}
