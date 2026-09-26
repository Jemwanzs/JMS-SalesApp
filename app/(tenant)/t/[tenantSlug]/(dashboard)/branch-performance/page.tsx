import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { BranchPeriodFilter } from "@/features/branch-performance/components/branch-period-filter";
import { KpiTileGrid } from "@/features/branch-performance/components/kpi-tile-grid";
import { OrderTrendChartLazy } from "@/features/branch-performance/components/order-trend-chart-lazy";
import { SimpleBreakdownList } from "@/features/branch-performance/components/simple-breakdown-list";
import { resolveBranchScope } from "@/features/branch-performance/lib/resolve-branch-scope";
import { OrderService } from "@/services/OrderService";
import { TenantService } from "@/services/TenantService";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { resolvePreset, todayString, type DatePreset } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Branch Performance | JMS Sales App",
};

const VALID_PRESETS: DatePreset[] = ["today", "yesterday", "this_week", "last_month", "this_month"];

/**
 * Company-Wide Reports / Branch Performance -- a new cross-cutting
 * analytics module gated on `analytics.branch_performance` (the module
 * entry gate, and separately the gate for whether the shared branch
 * filter offers anything beyond the caller's own current branch --
 * see resolveBranchScope's own header comment, the real enforcement
 * point). Each of the four tabs (Sales/Expenses/Stock/Orders) is ALSO
 * independently gated on the SAME permission its own dedicated
 * analytics page already uses (analytics.view_all/expenses.
 * view_analytics/inventory.view/orders.view_analytics) -- this page
 * builds no new per-tab permissions.
 *
 * Phase 1: only the Orders tab is wired (architecturally simplest --
 * no location-based RLS restriction on `orders` at all, unlike Sales/
 * Stock which need a service-role read for the cross-branch case,
 * landing in later phases). The Tabs shell already supports more than
 * one trigger; later phases just add TabsTrigger/TabsContent pairs
 * here, nothing about this structure needs to change.
 */
export default async function BranchPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ tab?: string; branch?: string; preset?: string; from?: string; to?: string }>;
}) {
  const { tenantSlug } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canViewModule, canViewOrdersTab, ordersEnabled] = await Promise.all([
    can("analytics.branch_performance", { tenantId: tenant.id }),
    can("orders.view_analytics", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "orders_enabled"),
  ]);
  if (!canViewModule) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const showOrdersTab = canViewOrdersTab && ordersEnabled !== false;
  const availableTabs = [...(showOrdersTab ? ["orders" as const] : [])];
  const activeTab = availableTabs.includes(query.tab as "orders") ? (query.tab as "orders") : availableTabs[0];

  const today = todayString(tenant.timezone);
  const selectedPreset = VALID_PRESETS.includes(query.preset as DatePreset) ? (query.preset as DatePreset) : null;
  const dateRange =
    query.from != null
      ? { from: query.from, to: query.to ?? query.from }
      : selectedPreset
        ? resolvePreset(selectedPreset, tenant.timezone)
        : { from: today, to: today };
  const effectivePreset = selectedPreset ?? (query.from != null ? null : "today");
  // Bound timestamptz columns (created_at/completed_at) with full-day
  // boundaries -- dateRange itself is plain YYYY-MM-DD, same convention
  // orders/page.tsx's own filters already use.
  const range = { from: `${dateRange.from}T00:00:00.000Z`, to: `${dateRange.to}T23:59:59.999Z` };

  const branchScope = await resolveBranchScope(supabase, tenant.id, query.branch ?? null);

  const orderService = new OrderService(supabase);
  let orderAnalytics: Awaited<ReturnType<OrderService["getOrderAnalytics"]>> | null = null;
  let orderTrend: Awaited<ReturnType<OrderService["getOrderTrend"]>> = [];
  let ordersByBranch: Awaited<ReturnType<OrderService["getOrdersByBranch"]>> = [];
  let ordersByEmployee: Awaited<ReturnType<OrderService["getOrdersByEmployee"]>> = [];

  if (showOrdersTab) {
    const showBranchBreakdown = branchScope.canPickAnyBranch && branchScope.effectiveLocationId === null;
    [orderAnalytics, orderTrend, ordersByBranch, ordersByEmployee] = await Promise.all([
      orderService.getOrderAnalytics(tenant.id, range, branchScope.effectiveLocationId),
      orderService.getOrderTrend(tenant.id, range, branchScope.effectiveLocationId),
      showBranchBreakdown ? orderService.getOrdersByBranch(tenant.id, range) : Promise.resolve([]),
      orderService.getOrdersByEmployee(tenant.id, range, branchScope.effectiveLocationId),
    ]);
  }

  return (
    <div className="flex flex-1 flex-col p-6 pb-24">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Branch Performance</h1>

      <BranchPeriodFilter
        branches={branchScope.allBranches}
        selectedLocationId={branchScope.selectedLocationId}
        selectedPreset={effectivePreset}
        from={query.from}
        to={query.to}
        activeTab={activeTab ?? "orders"}
      />

      {availableTabs.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No analytics are available for your account yet.</p>
      ) : (
        <Tabs defaultValue={activeTab} className="w-full">
          <div className="overflow-x-auto">
            <TabsList className="w-max">
              {showOrdersTab && <TabsTrigger value="orders">Orders</TabsTrigger>}
            </TabsList>
          </div>

          {showOrdersTab && orderAnalytics && (
            <TabsContent value="orders" className="space-y-4">
              <KpiTileGrid
                tiles={[
                  { label: "Total Orders", value: String(orderAnalytics.totalOrders) },
                  { label: "Completed Orders", value: String(orderAnalytics.completedOrders) },
                  { label: "Pending Orders", value: String(orderAnalytics.pendingOrders) },
                  { label: "On Delivery", value: String(orderAnalytics.onDeliveryOrders) },
                  { label: "Cancelled/Rejected", value: String(orderAnalytics.cancelledOrders) },
                  { label: "Total Completed Value", value: orderAnalytics.totalCompletedValue.toFixed(2) },
                  { label: "Average Completed Value", value: orderAnalytics.averageCompletedValue.toFixed(2) },
                ]}
              />
              {branchScope.effectiveLocationId != null && (
                <p className="text-xs text-muted-foreground">
                  Total/Pending/On Delivery/Cancelled always reflect every branch -- only Completed Orders and their value are
                  scoped to the selected branch (an order only records which branch processed it once completed).
                </p>
              )}

              <OrderTrendChartLazy data={orderTrend} />

              {ordersByBranch.length > 0 && (
                <SimpleBreakdownList
                  title="Orders by Branch"
                  entries={ordersByBranch.map((b) => ({ key: b.locationId, label: b.locationName, value: b.completedValue, count: b.completedCount }))}
                  countLabel={(c) => `${c} completed`}
                />
              )}

              {ordersByEmployee.length > 0 && (
                <SimpleBreakdownList
                  title="Orders by Employee"
                  entries={ordersByEmployee.map((e) => ({ key: e.employeeId, label: e.employeeName, value: e.completedValue, count: e.completedCount }))}
                  countLabel={(c) => `${c} completed`}
                />
              )}

              {orderTrend.length < 2 && ordersByEmployee.length === 0 && (
                <p className="text-center text-sm text-muted-foreground">Not enough activity yet to report on.</p>
              )}
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
