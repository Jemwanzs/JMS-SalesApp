import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface ExpenseBreakdownListEntry {
  key: string;
  label: string;
  total: number;
  count: number;
  /** Only ever set for the by-item breakdown (getSummary) -- no other dimension has an equivalent to compare against. */
  estimatedAmount?: number | null;
}

/**
 * Ranked, single-hue magnitude bars sized relative to the top entry,
 * same pattern ProductPerformanceList already uses for Sales Analytics
 * (one series, no categorical palette needed). Generalized from an
 * item-only shape to any dimension (category/vendor/payment-method/
 * branch/recorded-by) so this one component backs every breakdown on
 * the Expense Summary screen instead of five near-duplicates.
 */
export function ExpenseBreakdownList({ title, entries }: { title: string; entries: ExpenseBreakdownListEntry[] }) {
  if (entries.length === 0) {
    return null;
  }

  const maxTotal = Math.max(...entries.map((e) => e.total));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.key} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">{entry.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {entry.total.toFixed(2)} &middot; {entry.count} {entry.count === 1 ? "expense" : "expenses"}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${maxTotal > 0 ? (entry.total / maxTotal) * 100 : 0}%` }}
              />
            </div>
            {entry.estimatedAmount != null && (
              <p className="text-xs text-muted-foreground">
                Actual {entry.total.toFixed(2)} vs. estimated {entry.estimatedAmount.toFixed(2)}
                {" "}
                ({entry.total >= entry.estimatedAmount ? "+" : ""}
                {(entry.total - entry.estimatedAmount).toFixed(2)})
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
