import type { Metadata } from "next";

import { AnalyticsFilters } from "@/features/analytics/components/analytics-filters";
import { InsightsList } from "@/features/analytics/components/insights-list";
import { KpiCards } from "@/features/analytics/components/kpi-cards";
import { ProductPerformanceChart } from "@/features/analytics/components/product-performance-chart";
import { ProductPerformanceList } from "@/features/analytics/components/product-performance-list";
import { SalesTrendChart } from "@/features/analytics/components/sales-trend-chart";
import { UserPerformanceList } from "@/features/analytics/components/user-performance-list";
import { AnalyticsService, type AnalyticsPermissions } from "@/services/AnalyticsService";
import { InsightsService } from "@/services/InsightsService";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
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
 * (permission-gated date filters) -> product analytics"), later
 * extended with a "User Performance" tab (Gold/Silver/Bronze ranking by
 * sales agent, same idiom as Product Performance) -- gated on BOTH
 * analytics.all_users (previously only used for the "Active Sales
 * Users" KPI tile) and analytics.view_all (without it, every query here
 * is silently scoped to the caller's own sales, which would make a
 * cross-user ranking meaningless). The tab itself, not just its data,
 * is hidden outright when either is missing -- same "hidden, not shown-
 * disabled" convention AnalyticsFilters already uses for its own
 * permission-gated controls.
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

  const [user, { data: tenant }] = await Promise.all([
    getCurrentUser(),
    supabase.from("tenants").select("id, timezone").eq("slug", tenantSlug).single(),
  ]);

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
  let dailyTrend: Awaited<ReturnType<AnalyticsService["getDailyTrend"]>> = [];
  let productPerformance: Awaited<ReturnType<AnalyticsService["getProductPerformance"]>> = [];
  let userPerformance: Awaited<ReturnType<AnalyticsService["getUserPerformance"]>> = [];
  let insights: Awaited<ReturnType<InsightsService["listRecent"]>> = [];
  const canRankUsers = viewAll && allUsers;

  // None of these five depend on each other's result -- fetch them
  // together instead of one-at-a-time (same "independent, so parallel"
  // reasoning as the permission checks above).
  try {
    [kpis, dailyTrend, productPerformance, userPerformance, insights] = await Promise.all([
      analyticsService.getKpis(tenantId, range, today, perms, user!.id),
      analyticsService.getDailyTrend(tenantId, range, today, perms, user!.id),
      perms.products
        ? analyticsService.getProductPerformance(tenantId, range, today, perms, user!.id)
        : Promise.resolve([]),
      canRankUsers
        ? analyticsService.getUserPerformance(tenantId, range, today, perms, user!.id)
        : Promise.resolve([]),
      viewAll ? new InsightsService(supabase).listRecent(tenantId) : Promise.resolve([]),
    ]);
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
          <SalesTrendChart data={dailyTrend} />
          {perms.products && <ProductPerformanceChart items={productPerformance} />}
          <InsightsList insights={insights} />
          {kpis && <KpiCards kpis={kpis} />}
          {canRankUsers ? (
            <Tabs defaultValue="products">
              <TabsList>
                <TabsTrigger value="products">Products</TabsTrigger>
                <TabsTrigger value="users">User Performance</TabsTrigger>
              </TabsList>
              <TabsContent value="products">
                <ProductPerformanceList items={productPerformance} />
              </TabsContent>
              <TabsContent value="users">
                <UserPerformanceList items={userPerformance} />
              </TabsContent>
            </Tabs>
          ) : (
            <ProductPerformanceList items={productPerformance} />
          )}
        </div>
      )}
    </div>
  );
}
