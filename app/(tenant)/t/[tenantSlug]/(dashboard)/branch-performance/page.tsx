import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { KpiCards } from "@/features/analytics/components/kpi-cards";
import { ProductPerformanceChartLazy } from "@/features/analytics/components/product-performance-chart-lazy";
import { ProductPerformanceList } from "@/features/analytics/components/product-performance-list";
import { SalesTrendChartLazy } from "@/features/analytics/components/sales-trend-chart-lazy";
import { BranchPeriodFilter } from "@/features/branch-performance/components/branch-period-filter";
import { KpiTileGrid } from "@/features/branch-performance/components/kpi-tile-grid";
import { OrderTrendChartLazy } from "@/features/branch-performance/components/order-trend-chart-lazy";
import { SimpleBreakdownList } from "@/features/branch-performance/components/simple-breakdown-list";
import { resolveBranchScope } from "@/features/branch-performance/lib/resolve-branch-scope";
import { ExpenseBreakdownList } from "@/features/expenses/components/expense-breakdown-list";
import { ExpenseTrendChartLazy } from "@/features/expenses/components/expense-trend-chart-lazy";
import { LowStockList } from "@/features/stock/components/low-stock-list";
import { StockMovementChartLazy } from "@/features/stock/components/stock-movement-chart-lazy";
import { AnalyticsService, type AnalyticsPermissions } from "@/services/AnalyticsService";
import { ExpenseService } from "@/services/ExpenseService";
import { OrderService } from "@/services/OrderService";
import { StockService } from "@/services/StockService";
import { TenantService } from "@/services/TenantService";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getInventoryEntitlement } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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
 * All four tabs are wired: Orders and Expenses use the normal RLS-
 * respecting client (neither table has a current-branch-only lock --
 * Orders by design, Expenses via its own real expenses.view_all cross-
 * branch support). Sales and Stock both hit the SAME `current_active_
 * location()`-only RLS lock (migrations 0051/0066), so both construct
 * their service with a service-role client whenever the caller holds
 * analytics.branch_performance -- see the inline comment at each
 * client construction for the full reasoning.
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

  const tenantService = new TenantService(supabase);
  const [
    canViewModule,
    canViewOrdersTab,
    ordersEnabled,
    analyticsViewAll,
    analyticsPastDates,
    analyticsDateRange,
    analyticsProducts,
    analyticsAllUsers,
    analyticsEnabled,
    canViewExpensesTab,
    expensesEnabled,
    canViewStockTab,
    inventoryEntitlement,
  ] = await Promise.all([
    can("analytics.branch_performance", { tenantId: tenant.id }),
    can("orders.view_analytics", { tenantId: tenant.id }),
    tenantService.getSetting<boolean>(tenant.id, "orders_enabled"),
    can("analytics.view_all", { tenantId: tenant.id }),
    can("analytics.past_dates", { tenantId: tenant.id }),
    can("analytics.date_range", { tenantId: tenant.id }),
    can("analytics.products", { tenantId: tenant.id }),
    can("analytics.all_users", { tenantId: tenant.id }),
    tenantService.getSetting<boolean>(tenant.id, "analytics_enabled"),
    can("expenses.view_analytics", { tenantId: tenant.id }),
    tenantService.getSetting<boolean>(tenant.id, "expenses_enabled"),
    can("inventory.view", { tenantId: tenant.id }),
    getInventoryEntitlement(tenant.id),
  ]);
  if (!canViewModule) {
    redirect(`/t/${tenantSlug}/more`);
  }
  // Sales tab entry mirrors /analytics's own gate exactly: the standalone
  // page has no separate "view_own vs view_all" ENTRY permission -- it's
  // always viewable once the tenant's analytics_enabled setting is on,
  // and the viewAll/viewOwn split only affects SCOPE (fetchSales) not
  // visibility. Same rule here, so the Sales tab behaves identically to
  // its dedicated page for a viewer who's only ever used that one.
  const analyticsPerms: AnalyticsPermissions = {
    viewAll: analyticsViewAll,
    pastDates: analyticsPastDates,
    dateRange: analyticsDateRange,
    products: analyticsProducts,
    allUsers: analyticsAllUsers,
  };

  const showOrdersTab = canViewOrdersTab && ordersEnabled !== false;
  const showSalesTab = analyticsEnabled !== false;
  const showExpensesTab = canViewExpensesTab && expensesEnabled !== false;
  const showStockTab = canViewStockTab && inventoryEntitlement.enabled;
  type TabKey = "sales" | "expenses" | "stock" | "orders";
  const availableTabs: TabKey[] = [
    ...(showSalesTab ? (["sales"] as const) : []),
    ...(showExpensesTab ? (["expenses"] as const) : []),
    ...(showStockTab ? (["stock"] as const) : []),
    ...(showOrdersTab ? (["orders"] as const) : []),
  ];
  const activeTab = availableTabs.includes(query.tab as TabKey) ? (query.tab as TabKey) : availableTabs[0];

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

  // Sales/Stock RLS hard-locks every read to the caller's CURRENT active
  // branch (sales_select/stock_movements_select, migration 0051) -- no
  // permission has ever meant "cross-branch" for those two tables (see
  // this feature's plan doc). A canPickAnyBranch holder needs a service-
  // role client to read anything beyond their own branch; a confined
  // caller (or one who happens to have picked their own branch) gets the
  // exact same rows either way, so there's no reason to special-case
  // that -- always using service-role when canPickAnyBranch is true is
  // simplest and behaviorally identical, since every AnalyticsService
  // call below still explicitly passes effectiveLocationId as its own
  // app-layer filter regardless of which client executes the query.
  const analyticsClient = branchScope.canPickAnyBranch ? createServiceRoleClient() : supabase;
  const analyticsService = new AnalyticsService(analyticsClient);

  let salesErrorMessage: string | null = null;
  let kpis: Awaited<ReturnType<AnalyticsService["getKpis"]>> | null = null;
  let dailyTrend: Awaited<ReturnType<AnalyticsService["getDailyTrend"]>> = [];
  let productPerformance: Awaited<ReturnType<AnalyticsService["getProductPerformance"]>> = [];
  let salesByBranch: Awaited<ReturnType<AnalyticsService["getSalesByBranch"]>> = [];

  if (showSalesTab) {
    const showBranchBreakdown = branchScope.canPickAnyBranch && branchScope.effectiveLocationId === null;
    try {
      [kpis, dailyTrend, productPerformance, salesByBranch] = await Promise.all([
        analyticsService.getKpis(tenant.id, dateRange, today, analyticsPerms, user.id, branchScope.effectiveLocationId),
        analyticsService.getDailyTrend(tenant.id, dateRange, today, analyticsPerms, user.id, branchScope.effectiveLocationId),
        analyticsPerms.products
          ? analyticsService.getProductPerformance(tenant.id, dateRange, today, analyticsPerms, user.id, 10, branchScope.effectiveLocationId)
          : Promise.resolve([]),
        showBranchBreakdown ? analyticsService.getSalesByBranch(tenant.id, dateRange, today, analyticsPerms, user.id) : Promise.resolve([]),
      ]);
    } catch (err) {
      salesErrorMessage = err instanceof Error ? err.message : "Could not load Sales analytics";
    }
  }

  // Expenses RLS (expenses_select, migration 0080) already permits a
  // genuine cross-branch read for an expenses.view_all holder -- unlike
  // Sales/Stock, no service-role workaround is needed here. A
  // canPickAnyBranch holder who happens to lack expenses.view_all
  // (an unusual custom-role combination; both default Tenant-
  // Administrator-only) just gets RLS's own narrower result, the same
  // fail-closed behavior it already provides everywhere else -- not a
  // leak, just a quieter branch than the UI implied.
  const expenseService = new ExpenseService(supabase);
  let expensesErrorMessage: string | null = null;
  let expenseTotals: Awaited<ReturnType<ExpenseService["getRangeTotals"]>> = { total: 0, count: 0 };
  let expenseTrend: Awaited<ReturnType<ExpenseService["getTrend"]>> = [];
  let expenseBreakdown: Awaited<ReturnType<ExpenseService["getBreakdown"]>> = [];

  if (showExpensesTab) {
    try {
      [expenseTotals, expenseTrend, expenseBreakdown] = await Promise.all([
        expenseService.getRangeTotals(tenant.id, { ...dateRange, locationId: branchScope.effectiveLocationId ?? undefined }),
        expenseService.getTrend(tenant.id, { ...dateRange, locationId: branchScope.effectiveLocationId ?? undefined }),
        expenseService.getBreakdown(tenant.id, "category", { ...dateRange, locationId: branchScope.effectiveLocationId ?? undefined }),
      ]);
    } catch (err) {
      expensesErrorMessage = err instanceof Error ? err.message : "Could not load Expense analytics";
    }
  }

  // Same service-role rationale as Sales (§ comment above) -- stock_movements
  // RLS has the identical current-branch-only lock.
  const stockClient = branchScope.canPickAnyBranch ? createServiceRoleClient() : supabase;
  const stockService = new StockService(stockClient);
  let stockErrorMessage: string | null = null;
  let stockOverview: Awaited<ReturnType<StockService["getDailyOverviewSummary"]>> | null = null;
  let stockMovementTrend: Awaited<ReturnType<StockService["getMovementTrend"]>> = [];
  let stockMovementTotals: Awaited<ReturnType<StockService["getMovementTotals"]>> = { received: 0, sold: 0, adjusted: 0 };
  let topMovingProducts: Awaited<ReturnType<StockService["getTopMovingProducts"]>> = [];
  let lowStock: Awaited<ReturnType<StockService["listLowStock"]>> = [];

  if (showStockTab) {
    try {
      [stockOverview, stockMovementTrend, stockMovementTotals, topMovingProducts, lowStock] = await Promise.all([
        stockService.getDailyOverviewSummary(tenant.id, today, branchScope.effectiveLocationId),
        stockService.getMovementTrend(tenant.id, dateRange, branchScope.effectiveLocationId),
        stockService.getMovementTotals(tenant.id, dateRange, branchScope.effectiveLocationId),
        stockService.getTopMovingProducts(tenant.id, dateRange, branchScope.effectiveLocationId),
        stockService.listLowStock(tenant.id, branchScope.effectiveLocationId),
      ]);
    } catch (err) {
      stockErrorMessage = err instanceof Error ? err.message : "Could not load Stock analytics";
    }
  }

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
        activeTab={activeTab ?? "sales"}
      />

      {availableTabs.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No analytics are available for your account yet.</p>
      ) : (
        <Tabs defaultValue={activeTab} className="w-full">
          <div className="overflow-x-auto">
            <TabsList className="w-max">
              {showSalesTab && <TabsTrigger value="sales">Sales</TabsTrigger>}
              {showExpensesTab && <TabsTrigger value="expenses">Expenses</TabsTrigger>}
              {showStockTab && <TabsTrigger value="stock">Stock</TabsTrigger>}
              {showOrdersTab && <TabsTrigger value="orders">Orders</TabsTrigger>}
            </TabsList>
          </div>

          {showSalesTab && (
            <TabsContent value="sales" className="space-y-4">
              {salesErrorMessage ? (
                <p className="text-sm text-destructive">{salesErrorMessage}</p>
              ) : (
                kpis && (
                  <>
                    <KpiCards kpis={kpis} />
                    <SalesTrendChartLazy data={dailyTrend} />
                    {analyticsPerms.products && <ProductPerformanceChartLazy items={productPerformance} />}
                    {analyticsPerms.products && <ProductPerformanceList items={productPerformance} />}
                    {salesByBranch.length > 0 && (
                      <SimpleBreakdownList
                        title="Sales by Branch"
                        entries={salesByBranch.map((b) => ({ key: b.locationId, label: b.locationName, value: b.totalSales, count: b.transactionCount }))}
                        countLabel={(c) => `${c} transactions`}
                      />
                    )}
                    {dailyTrend.length < 2 && productPerformance.length === 0 && salesByBranch.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground">Not enough activity yet to report on.</p>
                    )}
                  </>
                )
              )}
            </TabsContent>
          )}

          {showExpensesTab && (
            <TabsContent value="expenses" className="space-y-4">
              {expensesErrorMessage ? (
                <p className="text-sm text-destructive">{expensesErrorMessage}</p>
              ) : (
                <>
                  <KpiTileGrid
                    tiles={[
                      { label: "Total Expenses", value: expenseTotals.total.toFixed(2) },
                      { label: "Expense Transactions", value: String(expenseTotals.count) },
                      { label: "Average Expense", value: expenseTotals.count > 0 ? (expenseTotals.total / expenseTotals.count).toFixed(2) : "0.00" },
                    ]}
                  />
                  <ExpenseTrendChartLazy data={expenseTrend} />
                  {expenseBreakdown.length > 0 && (
                    <ExpenseBreakdownList
                      title="Expenses by Category"
                      entries={expenseBreakdown.map((e) => ({ key: e.key, label: e.label, total: e.total, count: e.count }))}
                    />
                  )}
                  {expenseBreakdown.length > 0 && (
                    <ExpenseBreakdownList
                      title="Largest Expense Categories"
                      entries={expenseBreakdown.slice(0, 5).map((e) => ({ key: `top-${e.key}`, label: e.label, total: e.total, count: e.count }))}
                    />
                  )}
                  {expenseTrend.length < 2 && expenseBreakdown.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground">Not enough activity yet to report on.</p>
                  )}
                </>
              )}
            </TabsContent>
          )}

          {showStockTab && (
            <TabsContent value="stock" className="space-y-4">
              {stockErrorMessage ? (
                <p className="text-sm text-destructive">{stockErrorMessage}</p>
              ) : (
                stockOverview && (
                  <>
                    <KpiTileGrid
                      tiles={[
                        { label: "Stock Value", value: stockOverview.currentStockValue.toFixed(2) },
                        { label: "Items in Stock", value: String(stockOverview.currentStockQuantity) },
                        { label: "Stock Received", value: String(stockMovementTotals.received) },
                        { label: "Stock Sold", value: String(stockMovementTotals.sold) },
                        { label: "Stock Adjustments", value: String(stockMovementTotals.adjusted) },
                        { label: "Low-Stock Items", value: String(stockOverview.lowStockCount) },
                      ]}
                    />
                    {branchScope.effectiveLocationId != null && (
                      <p className="text-xs text-muted-foreground">
                        Per-branch stock tracking is new -- figures for a single branch may read as zero until movements start
                        recording a branch. Stock Value/Items in Stock reflect right now; Received/Sold/Adjustments reflect the
                        selected period.
                      </p>
                    )}
                    <StockMovementChartLazy data={stockMovementTrend} />
                    {topMovingProducts.length > 0 && (
                      <SimpleBreakdownList
                        title="Top-Moving Products"
                        entries={topMovingProducts.map((p) => ({ key: p.productId, label: p.name, value: p.totalMovedQuantity }))}
                        valueFormatter={(v) => String(v)}
                      />
                    )}
                    <LowStockList tenantSlug={tenantSlug} rows={lowStock} />
                    {stockMovementTrend.length < 2 && topMovingProducts.length === 0 && lowStock.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground">Not enough activity yet to report on.</p>
                    )}
                  </>
                )
              )}
            </TabsContent>
          )}

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
