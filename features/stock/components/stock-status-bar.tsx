import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StockOverviewSummary } from "@/services/StockService";

/**
 * The spec's "stock status distribution" visual -- one of the handful
 * of charts explicitly asked for, deliberately a single proportional bar
 * rather than a full chart component: three counts, at a glance, no
 * axes/legend-heavy chrome needed for something this simple.
 */
export function StockStatusBar({ summary }: { summary: StockOverviewSummary }) {
  const inStock = Math.max(0, summary.productsTracked - summary.lowStockCount - summary.outOfStockCount);
  const total = summary.productsTracked;

  if (total === 0) {
    return null;
  }

  const pct = (n: number) => (n / total) * 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {inStock > 0 && <div className="h-full bg-emerald-500" style={{ width: `${pct(inStock)}%` }} />}
          {summary.lowStockCount > 0 && <div className="h-full bg-amber-500" style={{ width: `${pct(summary.lowStockCount)}%` }} />}
          {summary.outOfStockCount > 0 && <div className="h-full bg-destructive" style={{ width: `${pct(summary.outOfStockCount)}%` }} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            In stock ({inStock})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Low ({summary.lowStockCount})
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-destructive" />
            Out ({summary.outOfStockCount})
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
