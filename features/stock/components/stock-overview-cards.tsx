import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import type { StockOverviewSummary } from "@/services/StockService";

function Tile({ label, value, tone }: { label: string; value: string; tone?: "default" | "warning" | "destructive" }) {
  return (
    <Card size="sm">
      <CardContent>
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={`mt-1 text-xl tabular-nums ${
            tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-amber-600 dark:text-amber-400" : ""
          }`}
        >
          {value}
        </CardTitle>
      </CardContent>
    </Card>
  );
}

/**
 * Stock module spec's Overview cards -- deliberately the set explicitly
 * asked for, not every number StockService could theoretically produce
 * ("do not fill the page with unnecessary charts/cards").
 */
export function StockOverviewCards({ summary }: { summary: StockOverviewSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="Current stock" value={summary.currentStockUnits.toFixed(0)} />
      <Tile label="Stock value" value={summary.stockValue.toFixed(2)} />
      <Tile label="Products tracked" value={String(summary.productsTracked)} />
      <Tile
        label="Low stock"
        value={String(summary.lowStockCount)}
        tone={summary.lowStockCount > 0 ? "warning" : "default"}
      />
      <Tile
        label="Out of stock"
        value={String(summary.outOfStockCount)}
        tone={summary.outOfStockCount > 0 ? "destructive" : "default"}
      />
      <Tile label="Stock added" value={summary.stockAddedValue.toFixed(2)} />
      <Tile label="Stock sold" value={summary.stockSoldValue.toFixed(2)} />
      <Tile label="Damaged / lost / adjusted" value={summary.damagedLostAdjustedValue.toFixed(2)} />
      <Tile label="Expected sales value" value={summary.expectedSalesValue.toFixed(2)} />
      <Tile label="Actual sales value" value={summary.actualSalesValue.toFixed(2)} />
      <Tile
        label="Stock variance"
        value={summary.stockVarianceValue.toFixed(2)}
        tone={summary.stockVarianceValue > 0 ? "warning" : "default"}
      />
    </div>
  );
}
