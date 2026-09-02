import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExpenseSummaryItem } from "@/services/ExpenseService";

/**
 * Expense Breakdown by Item + Actual vs Estimated, per spec -- ranked,
 * single-hue magnitude bars sized relative to the top item, same
 * pattern ProductPerformanceList already uses for Sales Analytics (one
 * series, no categorical palette needed).
 */
export function ExpenseBreakdownList({ items }: { items: ExpenseSummaryItem[] }) {
  if (items.length === 0) {
    return null;
  }

  const maxTotal = Math.max(...items.map((i) => i.total));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Expense Breakdown by Item</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.expenseItemId} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{item.expenseItemName}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.total.toFixed(2)} &middot; {item.count} {item.count === 1 ? "expense" : "expenses"}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${maxTotal > 0 ? (item.total / maxTotal) * 100 : 0}%` }}
              />
            </div>
            {item.estimatedAmount != null && (
              <p className="text-xs text-muted-foreground">
                Actual {item.total.toFixed(2)} vs. estimated {item.estimatedAmount.toFixed(2)}
                {" "}
                ({item.total >= item.estimatedAmount ? "+" : ""}
                {(item.total - item.estimatedAmount).toFixed(2)})
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
