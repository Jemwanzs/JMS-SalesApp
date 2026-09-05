import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StockTabs } from "@/features/stock/components/stock-tabs";
import { BusinessDayService } from "@/services/BusinessDayService";
import { StockService } from "@/services/StockService";
import { getInventoryEntitlement } from "@/lib/inventory/entitlement";
import { getStockControlMethod } from "@/lib/inventory/stock-control-method";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { subtractDays, todayString, trailingDaysRange } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Stock | JMS Sales App",
};

const OVERVIEW_WINDOW_DAYS = 30;

/**
 * Robust Stock/Inventory Management: a single "Stock" bottom-nav
 * destination (unchanged) with six internal sub-tabs (Overview / Items /
 * Stock In / Adjust / Reconcile / History) instead of the previous
 * separate-route model -- see docs/21-inventory-management.md. Every
 * tab's data is fetched here, up front, in parallel: this app's stock
 * volume is modest enough that a single request per tab switch isn't
 * warranted (the same reasoning stock_balances' own view already
 * applies), and it keeps StockTabs a plain client component with no
 * data-fetching of its own. The Overview tab's own Today/Yesterday/
 * Select Date filter is the one exception -- driven by `?overviewDate=`
 * so switching it re-renders this whole page with a fresh
 * getDailyOverviewSummary() call, while every other tab's data stays
 * exactly as it was (unaffected by that param).
 */
export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ overviewDate?: string }>;
}) {
  const { tenantSlug } = await params;
  const { overviewDate } = await searchParams;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  const [canView, entitlement] = await Promise.all([can("inventory.view", { tenantId }), getInventoryEntitlement(tenantId)]);
  if (!canView || !entitlement.enabled) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const [canRecord, canReconcile] = await Promise.all([
    can("stock.movement.record", { tenantId }),
    can("stock.reconcile", { tenantId }),
  ]);

  const stockService = new StockService(supabase);
  const overviewRange = trailingDaysRange(OVERVIEW_WINDOW_DAYS, tenant!.timezone);

  const activeLocationId = await resolveActiveLocationId(supabase, tenantId);
  const today = activeLocationId
    ? (await new BusinessDayService(supabase).getEffectiveBusinessDate(tenantId, activeLocationId)).date
    : todayString(tenant!.timezone);
  const yesterday = subtractDays(today, 1);
  const selectedOverviewDate = overviewDate && overviewDate <= today ? overviewDate : today;

  const [dailySummary, movementTrend, lowStock, balances, pendingReconciliation, historyEntries, stockControlMethod] =
    await Promise.all([
      stockService.getDailyOverviewSummary(tenantId, selectedOverviewDate),
      stockService.getMovementTrend(tenantId, overviewRange),
      stockService.listLowStock(tenantId),
      stockService.listBalances(tenantId),
      canReconcile ? stockService.listPendingReconciliation(tenantId, today) : Promise.resolve([]),
      stockService.listHistory(tenantId),
      getStockControlMethod(supabase, tenantId),
    ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">Stock</h1>
      <StockTabs
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        summary={dailySummary}
        todayDate={today}
        yesterdayDate={yesterday}
        movementTrend={movementTrend}
        lowStock={lowStock}
        balances={balances}
        pendingReconciliation={pendingReconciliation}
        historyEntries={historyEntries}
        canRecord={canRecord}
        canReconcile={canReconcile}
        stockControlMethod={stockControlMethod}
      />
    </div>
  );
}
