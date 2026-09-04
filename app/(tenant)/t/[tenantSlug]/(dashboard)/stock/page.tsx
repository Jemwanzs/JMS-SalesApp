import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StockTabs } from "@/features/stock/components/stock-tabs";
import { BusinessDayService } from "@/services/BusinessDayService";
import { StockService } from "@/services/StockService";
import { getInventoryEntitlement } from "@/lib/inventory/entitlement";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { todayString, trailingDaysRange } from "@/lib/utils/date-ranges";

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
 * data-fetching of its own.
 */
export default async function StockPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
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

  const [summary, movementTrend, varianceReport, lowStock, balances, pendingReconciliation, historyEntries] = await Promise.all([
    stockService.getOverviewSummary(tenantId, overviewRange),
    stockService.getMovementTrend(tenantId, overviewRange),
    stockService.getVarianceReport(tenantId, overviewRange),
    stockService.listLowStock(tenantId),
    stockService.listBalances(tenantId),
    canReconcile ? stockService.listPendingReconciliation(tenantId, today) : Promise.resolve([]),
    stockService.listHistory(tenantId),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">Stock</h1>
      <StockTabs
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        summary={summary}
        movementTrend={movementTrend}
        varianceReport={varianceReport}
        lowStock={lowStock}
        balances={balances}
        pendingReconciliation={pendingReconciliation}
        historyEntries={historyEntries}
        canRecord={canRecord}
        canReconcile={canReconcile}
      />
    </div>
  );
}
