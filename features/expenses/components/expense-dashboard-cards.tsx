"use client";

import { usePathname } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import type { ExpenseDashboardSummary } from "@/services/ExpenseService";
import type { LocationSummary } from "@/services/LocationService";

/**
 * Clickable KPI tiles for the Expense Dashboard. Pending Approval landed
 * in Phase 2a (migration 0085); Pending Reimbursements landed in Phase 2b
 * (migration 0086). Budget vs Actual is still deliberately omitted, since
 * that subsystem doesn't exist yet; showing a fake/zero card for it would
 * misrepresent the feature as further along than it is. Revisit once the
 * relevant phase lands.
 *
 * A real browser navigation (window.location.assign), not router.push --
 * this Next.js build's client router can silently fail to commit a
 * same-pathname, different-search-param navigation (see
 * SaleHistoryFilters' own header comment for the full story).
 */
export function ExpenseDashboardCards({
  summary,
  todayDate,
  weekStart,
  monthStart,
  locations,
  canViewAll,
}: {
  summary: ExpenseDashboardSummary;
  todayDate: string;
  weekStart: string;
  monthStart: string;
  locations: LocationSummary[];
  canViewAll: boolean;
}) {
  const pathname = usePathname();
  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));

  function go(params: Record<string, string>) {
    const search = new URLSearchParams(params);
    window.location.assign(`${pathname}?${search.toString()}`);
  }

  return (
    <div className="mb-4 grid grid-cols-2 gap-2">
      <button type="button" onClick={() => go({ date: todayDate })} className="text-left">
        <Card className="h-full transition-colors hover:bg-muted">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Today</p>
            <p className="text-lg font-semibold tabular-nums">{summary.todayTotal.toFixed(2)}</p>
          </CardContent>
        </Card>
      </button>

      <button type="button" onClick={() => go({ from: weekStart, to: todayDate })} className="text-left">
        <Card className="h-full transition-colors hover:bg-muted">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">This Week</p>
            <p className="text-lg font-semibold tabular-nums">{summary.thisWeekTotal.toFixed(2)}</p>
          </CardContent>
        </Card>
      </button>

      <button type="button" onClick={() => go({ from: monthStart, to: todayDate })} className="text-left">
        <Card className="h-full transition-colors hover:bg-muted">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">This Month</p>
            <p className="text-lg font-semibold tabular-nums">{summary.thisMonthTotal.toFixed(2)}</p>
          </CardContent>
        </Card>
      </button>

      <button
        type="button"
        onClick={() => go({ hasReceipt: "false" })}
        className="text-left"
        disabled={summary.withoutReceiptCount === 0}
      >
        <Card className="h-full transition-colors hover:bg-muted">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Without Receipts</p>
            <p className="text-lg font-semibold tabular-nums">{summary.withoutReceiptCount}</p>
          </CardContent>
        </Card>
      </button>

      <button
        type="button"
        onClick={() => go({ status: "pending_approval" })}
        className="text-left"
        disabled={summary.pendingApprovalCount === 0}
      >
        <Card className="h-full transition-colors hover:bg-muted">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Pending Approval</p>
            <p className="text-lg font-semibold tabular-nums">{summary.pendingApprovalCount}</p>
            {summary.pendingApprovalCount > 0 && (
              <p className="text-xs text-muted-foreground">{summary.pendingApprovalTotal.toFixed(2)}</p>
            )}
          </CardContent>
        </Card>
      </button>

      <button
        type="button"
        onClick={() => go({ reimbursementStatus: "pending" })}
        className="text-left"
        disabled={summary.pendingReimbursementCount === 0}
      >
        <Card className="h-full transition-colors hover:bg-muted">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Pending Reimbursements</p>
            <p className="text-lg font-semibold tabular-nums">{summary.pendingReimbursementCount}</p>
            {summary.pendingReimbursementCount > 0 && (
              <p className="text-xs text-muted-foreground">{summary.pendingReimbursementTotal.toFixed(2)}</p>
            )}
          </CardContent>
        </Card>
      </button>

      {summary.topCategoryName && (
        <button type="button" onClick={() => go({ categoryId: summary.topCategoryId! })} className="text-left">
          <Card className="h-full transition-colors hover:bg-muted">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Top Category</p>
              <p className="truncate text-sm font-semibold">{summary.topCategoryName}</p>
            </CardContent>
          </Card>
        </button>
      )}

      {summary.topVendor && (
        <button type="button" onClick={() => go({ vendor: summary.topVendor! })} className="text-left">
          <Card className="h-full transition-colors hover:bg-muted">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">Top Vendor</p>
              <p className="truncate text-sm font-semibold">{summary.topVendor}</p>
            </CardContent>
          </Card>
        </button>
      )}

      {canViewAll && summary.byBranch.length > 1 && (
        <Card className="col-span-2">
          <CardContent className="space-y-1.5 p-3">
            <p className="text-xs text-muted-foreground">Expenses by Branch</p>
            {summary.byBranch.map((branch) => (
              <button
                key={branch.locationId}
                type="button"
                onClick={() => go({ locationId: branch.locationId, from: monthStart, to: todayDate })}
                className="flex w-full items-center justify-between rounded px-1 py-0.5 text-sm hover:bg-muted"
              >
                <span className="truncate">{locationNameById.get(branch.locationId) ?? "Unknown branch"}</span>
                <span className="shrink-0 tabular-nums">{branch.total.toFixed(2)}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
