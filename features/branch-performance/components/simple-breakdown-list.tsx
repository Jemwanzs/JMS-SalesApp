import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface BreakdownEntry {
  key: string;
  label: string;
  value: number;
  count?: number;
}

/**
 * Ranked, single-hue magnitude bars sized relative to the top entry --
 * same visual convention as ExpenseBreakdownList/ProductPerformanceList,
 * generalized further (no "expenses" unit baked in) since this backs
 * "Sales by Branch," "Top-Moving Products," "Orders by Branch," and
 * "Orders by Employee" -- four different units across two different
 * services, none of which is expenses.
 */
export function SimpleBreakdownList({
  title,
  entries,
  valueFormatter = (v) => v.toFixed(2),
  countLabel,
}: {
  title: string;
  entries: BreakdownEntry[];
  valueFormatter?: (value: number) => string;
  countLabel?: (count: number) => string;
}) {
  if (entries.length === 0) {
    return null;
  }

  const maxValue = Math.max(...entries.map((e) => e.value));

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
                {valueFormatter(entry.value)}
                {entry.count != null && countLabel ? ` · ${countLabel(entry.count)}` : ""}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${maxValue > 0 ? (entry.value / maxValue) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
