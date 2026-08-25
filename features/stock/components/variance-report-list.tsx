import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { VarianceReportRow } from "@/services/StockService";

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Plain ranked list, not a chart -- the reason text is the point of
 * this report (why did the count come up short/over), and that's
 * inherently tabular, not something a bar's length can carry. Biggest
 * discrepancy first (StockService.getVarianceReport's own sort).
 */
export function VarianceReportList({ rows }: { rows: VarianceReportRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reconciliation variances</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((row) => {
          const over = row.variance > 0;
          return (
            <div key={row.reconciliationId} className="space-y-0.5 border-b pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate font-medium">{row.productName}</span>
                <span className={`shrink-0 tabular-nums ${over ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                  {over ? "+" : ""}
                  {row.variance} {row.unitOfMeasure ?? ""}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDate(row.reconciliationDate)}
                {row.varianceReason ? ` · ${row.varianceReason}` : ""}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
