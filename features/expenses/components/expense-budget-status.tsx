"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExpenseBudgetStatusEntry } from "@/services/ExpenseBudgetService";

/**
 * This-month progress against every active budget at the current branch
 * -- same three-color threshold bar language StockStatusBar already
 * established (emerald under 75%, amber 75-100%, destructive at/over
 * 100%), just one bar per category instead of one bar split three ways.
 * Renders nothing when there are no budgets configured for this branch,
 * same "no fake/empty state for an unconfigured feature" convention the
 * dashboard KPI tiles already follow.
 */
export function ExpenseBudgetStatus({ items }: { items: ExpenseBudgetStatusEntry[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Budgets this month</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => {
          const pct = Math.min(100, Math.max(0, item.percentUsed));
          const barColor = item.percentUsed >= 100 ? "bg-destructive" : item.percentUsed >= 75 ? "bg-amber-500" : "bg-emerald-500";

          return (
            <div key={item.budgetId} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate font-medium">{item.categoryName}</span>
                <span className={`shrink-0 tabular-nums ${item.percentUsed >= 100 ? "text-destructive" : "text-muted-foreground"}`}>
                  {item.spent.toFixed(2)} / {item.monthlyAmount.toFixed(2)}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
              </div>
              {item.percentUsed >= 100 && (
                <p className="text-xs text-destructive">Over budget by {Math.abs(item.remaining).toFixed(2)}</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
