import type { Metadata } from "next";

import { AnalyticsFilters } from "@/features/analytics/components/analytics-filters";
import { KpiCards } from "@/features/analytics/components/kpi-cards";
import { ProductPerformanceList } from "@/features/analytics/components/product-performance-list";
import { AnalyticsService, type AnalyticsPermissions } from "@/services/AnalyticsService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { resolvePreset, todayString, type DatePreset } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Analytics | JMS Sales App",
};

const VALID_PRESETS: DatePreset[] = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
];

/**
 * Phase 3's first increment (docs/01-development-roadmap.md: "daily
 * aggregate computation on close [done, 2b/2f] -> KPI dashboard
 * (permission-gated date filters) -> product analytics"). User/location
 * breakdowns and scheduled reports are later Phase 3 increments, not
 * this one -- analytics.all_users only gates the one "Active Sales
 * Users" KPI tile here, not a full per-user table yet.
 */
export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const { tenantSlug } = await params;
  const { preset, from, to } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, timezone")
    .eq("slug", tenantSlug)
    .single();

  const tenantId = tenant!.id;
  const timezone = tenant!.timezone;
  const today = todayString(timezone);

  const [viewAll, pastDates, dateRange, products, allUsers] = await Promise.all([
    can("analytics.view_all", { tenantId }),
    can("analytics.past_dates", { tenantId }),
    can("analytics.date_range", { tenantId }),
    can("analytics.products", { tenantId }),
    can("analytics.all_users", { tenantId }),
  ]);
  const perms: AnalyticsPermissions = { viewAll, pastDates, dateRange, products, allUsers };

  const range =
    from != null
      ? { from, to: to ?? from }
      : resolvePreset(VALID_PRESETS.includes(preset as DatePreset) ? (preset as DatePreset) : "today", timezone);

  const analyticsService = new AnalyticsService(supabase);

  let errorMessage: string | null = null;
  let kpis = null;
  let productPerformance: Awaited<ReturnType<AnalyticsService["getProductPerformance"]>> = [];

  try {
    kpis = await analyticsService.getKpis(tenantId, range, today, perms, user!.id);
    if (perms.products) {
      productPerformance = await analyticsService.getProductPerformance(
        tenantId,
        range,
        today,
        perms,
        user!.id
      );
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Could not load analytics";
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">Analytics</h1>
      <AnalyticsFilters canPastDates={pastDates} canDateRange={dateRange} />

      {errorMessage ? (
        <p className="text-sm text-destructive">{errorMessage}</p>
      ) : (
        <div className="space-y-4">
          {kpis && <KpiCards kpis={kpis} />}
          <ProductPerformanceList items={productPerformance} />
        </div>
      )}
    </div>
  );
}
