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
  return (
    <Tabs defaultValue="overview">
      {/* flex-1 (the shared TabsTrigger's default) squeezes every tab into
          an equal, ever-shrinking fraction of the bar's width -- fine for
          Analytics' 2 tabs, but with up to 6 here it silently clipped
          label text. Two later fixes were each reverted after feedback:
          a single scrollable row (History disappearing off-screen with
          no visible affordance it could be scrolled to), then plain
          flex-wrap (packed 5 tabs onto row one and stranded History
          alone on a cramped row two -- width-dependent natural packing,
          not the clean split asked for). A fixed 4-column CSS grid
          settles this deterministically regardless of viewport width or
          label length: exactly 4 tabs per row, any 5th/6th wrapping onto
          a full second row -- Overview/Items/Stock In/Adjust, then
          Reconcile/History, matching the requested layout exactly
          whenever all six are visible, and degrading gracefully to one
          row when fewer are (a Sales User with neither canRecord nor
          canReconcile sees only 3). */}
      <TabsList className="grid h-auto w-full grid-cols-4 gap-1.5">
        <TabsTrigger value="overview" className="flex-none justify-self-stretch">
          Overview
        </TabsTrigger>
        <TabsTrigger value="items" className="flex-none justify-self-stretch">
          Items
        </TabsTrigger>
        {canRecord && (
          <TabsTrigger value="stock-in" className="flex-none justify-self-stretch">
            Stock In
          </TabsTrigger>
        )}
        {canRecord && (
          <TabsTrigger value="adjust" className="flex-none justify-self-stretch">
            Adjust
          </TabsTrigger>
        )}
        {canReconcile && (
          <TabsTrigger value="reconcile" className="flex-none justify-self-stretch">
            Reconcile
          </TabsTrigger>
        )}
        <TabsTrigger value="history" className="flex-none justify-self-stretch">
          History
        </TabsTrigger>
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
