"use client";

import { ReconciliationQueueList } from "@/features/stock/components/reconciliation-queue-list";
import { StockActionList } from "@/features/stock/components/stock-action-list";
import { StockDashboardList } from "@/features/stock/components/stock-dashboard-list";
import { StockHistoryList } from "@/features/stock/components/stock-history-list";
import { StockMovementChartLazy } from "@/features/stock/components/stock-movement-chart-lazy";
import { StockOverviewCards } from "@/features/stock/components/stock-overview-cards";
import { StockStatusBar } from "@/features/stock/components/stock-status-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  DailyMovementPoint,
  StockBalanceRow,
  StockHistoryEntry,
  StockOverviewSummary,
  VarianceReportRow,
} from "@/services/StockService";

const STOCK_IN_ACTIONS = [
  { type: "opening_stock" as const, label: "Opening stock" },
  { type: "stock_in" as const, label: "Stock in" },
];

const ADJUST_ACTIONS = [
  { type: "stock_out" as const, label: "Stock out" },
  { type: "adjustment_increase" as const, label: "Adjust +" },
  { type: "adjustment_decrease" as const, label: "Adjust −" },
  { type: "damaged" as const, label: "Damaged" },
  { type: "expired" as const, label: "Expired" },
  { type: "lost" as const, label: "Lost/missing" },
];

export function StockTabs({
  tenantId,
  tenantSlug,
  summary,
  movementTrend,
  varianceReport,
  lowStock,
  balances,
  pendingReconciliation,
  historyEntries,
  canRecord,
  canReconcile,
}: {
  tenantId: string;
  tenantSlug: string;
  summary: StockOverviewSummary;
  movementTrend: DailyMovementPoint[];
  varianceReport: VarianceReportRow[];
  lowStock: StockBalanceRow[];
  balances: StockBalanceRow[];
  pendingReconciliation: StockBalanceRow[];
  historyEntries: StockHistoryEntry[];
  canRecord: boolean;
  canReconcile: boolean;
}) {
  return (
    <Tabs defaultValue="overview">
      {/* flex-1 (the shared TabsTrigger's default) squeezes every tab into
          an equal, ever-shrinking fraction of the bar's width -- fine for
          Analytics' 2 tabs, but with 6 here it silently clips label text
          (no scrolling ever kicks in, since the row never actually
          exceeds the container). flex-none + shrink-0 lets each tab keep
          its natural width instead, so the row genuinely overflows and
          overflow-x-auto below can do its job -- swipe/scroll to reach
          every tab at a readable size, same idiom as a native app's
          scrollable tab strip. */}
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview" className="flex-none shrink-0">
          Overview
        </TabsTrigger>
        <TabsTrigger value="items" className="flex-none shrink-0">
          Items
        </TabsTrigger>
        {canRecord && (
          <TabsTrigger value="stock-in" className="flex-none shrink-0">
            Stock In
          </TabsTrigger>
        )}
        {canRecord && (
          <TabsTrigger value="adjust" className="flex-none shrink-0">
            Adjust
          </TabsTrigger>
        )}
        {canReconcile && (
          <TabsTrigger value="reconcile" className="flex-none shrink-0">
            Reconcile
          </TabsTrigger>
        )}
        <TabsTrigger value="history" className="flex-none shrink-0">
          History
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 pt-4">
        <StockOverviewCards summary={summary} balances={balances} lowStock={lowStock} varianceReport={varianceReport} tenantSlug={tenantSlug} />
        <StockStatusBar summary={summary} />
        <StockMovementChartLazy data={movementTrend} />
        {movementTrend.length < 2 && varianceReport.length === 0 && lowStock.length === 0 && (
          <p className="text-center text-sm text-muted-foreground">Not enough activity yet to report on.</p>
        )}
      </TabsContent>

      <TabsContent value="items" className="pt-4">
        <StockDashboardList tenantSlug={tenantSlug} balances={balances} />
      </TabsContent>

      {canRecord && (
        <TabsContent value="stock-in" className="pt-4">
          <StockActionList
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            balances={balances}
            actions={STOCK_IN_ACTIONS}
            emptyLabel="No tracked products yet -- add one from Products first."
          />
        </TabsContent>
      )}

      {canRecord && (
        <TabsContent value="adjust" className="pt-4">
          <StockActionList
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            balances={balances}
            actions={ADJUST_ACTIONS}
            emptyLabel="No tracked products yet -- add one from Products first."
          />
        </TabsContent>
      )}

      {canReconcile && (
        <TabsContent value="reconcile" className="space-y-1 pt-4">
          <p className="mb-3 text-sm text-muted-foreground">Today&apos;s physical count</p>
          <ReconciliationQueueList tenantSlug={tenantSlug} pending={pendingReconciliation} />
        </TabsContent>
      )}

      <TabsContent value="history" className="pt-4">
        <StockHistoryList entries={historyEntries} />
      </TabsContent>
    </Tabs>
  );
}
