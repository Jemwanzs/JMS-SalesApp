"use client";

import { ReconciliationQueueList } from "@/features/stock/components/reconciliation-queue-list";
import { StockActionList } from "@/features/stock/components/stock-action-list";
import { StockDashboardList } from "@/features/stock/components/stock-dashboard-list";
import { StockHistoryList } from "@/features/stock/components/stock-history-list";
import { StockMovementChartLazy } from "@/features/stock/components/stock-movement-chart-lazy";
import { StockOverviewCards } from "@/features/stock/components/stock-overview-cards";
import { StockOverviewDateFilter } from "@/features/stock/components/stock-overview-date-filter";
import { StockStatusBar } from "@/features/stock/components/stock-status-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  DailyMovementPoint,
  StockBalanceRow,
  StockDailyOverviewSummary,
  StockHistoryEntry,
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
  todayDate,
  yesterdayDate,
  movementTrend,
  lowStock,
  balances,
  pendingReconciliation,
  historyEntries,
  canRecord,
  canReconcile,
  stockControlMethod,
}: {
  tenantId: string;
  tenantSlug: string;
  summary: StockDailyOverviewSummary;
  todayDate: string;
  yesterdayDate: string;
  movementTrend: DailyMovementPoint[];
  lowStock: StockBalanceRow[];
  balances: StockBalanceRow[];
  pendingReconciliation: StockBalanceRow[];
  historyEntries: StockHistoryEntry[];
  canRecord: boolean;
  canReconcile: boolean;
  stockControlMethod: "quantity" | "value";
}) {
  // Fixed row CHUNKS, not a 4-column grid -- the grid version put a
  // ragged last row (Reconcile/History) flush against columns 1-2 with
  // 3-4 sitting empty, reading as ill-spaced and left-stuck rather than
  // "look like line 1." Chunking into groups of (up to) 4 and giving
  // each its OWN centered, independently-pilled row -- rather than one
  // shared grid/flex track -- means a short remainder row visually
  // centers itself instead of hugging the row above's left edge. Two
  // earlier attempts (a single scrollable row, then plain flex-wrap)
  // were each reverted after feedback for looking broken or splitting
  // unevenly; this keeps the deterministic "4 per row" split those both
  // lacked, but fixes the leftover-row centering the plain grid missed.
  const allTabs = [
    { value: "overview", label: "Overview" },
    { value: "items", label: "Items" },
    ...(canRecord ? [{ value: "stock-in", label: "Stock In" }, { value: "adjust", label: "Adjust" }] : []),
    ...(canReconcile ? [{ value: "reconcile", label: "Reconcile" }] : []),
    { value: "history", label: "History" },
  ];
  const tabRows: (typeof allTabs)[] = [];
  for (let i = 0; i < allTabs.length; i += 4) tabRows.push(allTabs.slice(i, i + 4));

  return (
    <Tabs defaultValue="overview">
      <TabsList className="h-auto w-full flex-col gap-2 bg-transparent p-0">
        {tabRows.map((row, i) => (
          <div key={i} className="flex w-full justify-center gap-1.5 rounded-lg bg-muted p-[3px]">
            {row.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-none">
                {tab.label}
              </TabsTrigger>
            ))}
          </div>
        ))}
      </TabsList>

      <TabsContent value="overview" className="space-y-4 pt-4">
        <StockOverviewDateFilter todayDate={todayDate} yesterdayDate={yesterdayDate} selectedDate={summary.date} />
        <StockOverviewCards
          summary={summary}
          stockControlMethod={stockControlMethod}
          balances={balances}
          lowStock={lowStock}
          tenantSlug={tenantSlug}
        />
        <StockStatusBar summary={summary} />
        <StockMovementChartLazy data={movementTrend} />
        {movementTrend.length < 2 && (
          <p className="text-center text-sm text-muted-foreground">Not enough movement history yet to chart a trend.</p>
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
            stockControlMethod={stockControlMethod}
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
            stockControlMethod={stockControlMethod}
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
