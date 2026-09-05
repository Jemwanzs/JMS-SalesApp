"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import type { StockBalanceRow, StockOverviewSummary, VarianceReportRow } from "@/services/StockService";

type MetricKey =
  | "currentStock"
  | "stockValue"
  | "productsTracked"
  | "lowStock"
  | "outOfStock"
  | "stockAdded"
  | "stockSold"
  | "damaged"
  | "expectedSales"
  | "actualSales"
  | "variance";

interface MetricDef {
  label: string;
  value: string;
  tone?: "default" | "warning" | "destructive";
  explanation: string;
}

function Tile({ def, onClick }: { def: MetricDef; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left transition-transform hover:-translate-y-0.5 active:translate-y-0"
    >
      <Card
        size="sm"
        className="h-full cursor-pointer transition-shadow hover:border-primary/50 hover:shadow-md"
      >
        <CardContent>
          <CardDescription>{def.label}</CardDescription>
          <CardTitle
            className={`mt-1 text-xl tabular-nums ${
              def.tone === "destructive" ? "text-destructive" : def.tone === "warning" ? "text-amber-600 dark:text-amber-400" : ""
            }`}
          >
            {def.value}
          </CardTitle>
        </CardContent>
      </Card>
    </button>
  );
}

/**
 * Stock module spec's Overview cards -- the set explicitly asked for,
 * not every number StockService could theoretically produce ("do not
 * fill the page with unnecessary charts/cards"). Every card is tappable:
 * a hover/press affordance plus a detail dialog that either explains how
 * the figure is calculated or, where the underlying rows are already on
 * hand (low stock, out of stock, variance), shows them directly rather
 * than making the tenant hunt for the same list on another tab.
 */
export function StockOverviewCards({
  summary,
  balances,
  lowStock,
  varianceReport,
  tenantSlug,
}: {
  summary: StockOverviewSummary;
  balances: StockBalanceRow[];
  lowStock: StockBalanceRow[];
  varianceReport: VarianceReportRow[];
  tenantSlug: string;
}) {
  const [openMetric, setOpenMetric] = useState<MetricKey | null>(null);
  const outOfStock = balances.filter((b) => b.balance <= 0);

  const defs: Record<MetricKey, MetricDef> = {
    currentStock: {
      label: "Current stock",
      value: summary.currentStockUnits.toFixed(0),
      explanation: "Total units on hand right now, summed across every tracked product's own unit of measure.",
    },
    stockValue: {
      label: "Stock value",
      value: summary.stockValue.toFixed(2),
      explanation:
        "Current balance × each product's cost price, summed across every tracked product. A product with no cost price set contributes 0 here -- add one in Products to include it.",
    },
    productsTracked: {
      label: "Products tracked",
      value: String(summary.productsTracked),
      explanation: "Active products with stock tracking turned on (Products → edit → Track inventory).",
    },
    lowStock: {
      label: "Low stock",
      value: String(summary.lowStockCount),
      tone: summary.lowStockCount > 0 ? "warning" : "default",
      explanation: "Tracked products at or below their own configured low-stock alert threshold, but not yet at zero.",
    },
    outOfStock: {
      label: "Out of stock",
      value: String(summary.outOfStockCount),
      tone: summary.outOfStockCount > 0 ? "destructive" : "default",
      explanation: "Tracked products whose current balance has reached zero or below.",
    },
    stockAdded: {
      label: "Stock added",
      value: summary.stockAddedValue.toFixed(2),
      explanation: "Value of Opening Stock and Stock In movements in the last 30 days, at each movement's own cost price.",
    },
    stockSold: {
      label: "Stock sold",
      value: summary.stockSoldValue.toFixed(2),
      explanation: "Value of stock consumed by sales (and manual stock-out) in the last 30 days, at each movement's own selling price.",
    },
    damaged: {
      label: "Damaged / lost / adjusted",
      value: summary.damagedLostAdjustedValue.toFixed(2),
      explanation: "Value of damaged, expired, lost, and downward adjustment movements in the last 30 days, at cost price.",
    },
    expectedSales: {
      label: "Expected sales value",
      value: summary.expectedSalesValue.toFixed(2),
      explanation: "Current balance × each product's selling price -- what the stock on hand right now would sell for if all of it moved.",
    },
    actualSales: {
      label: "Actual sales value",
      value: summary.actualSalesValue.toFixed(2),
      explanation: "Real recorded revenue (excluding voided/corrected sales) for tracked products in the last 30 days.",
    },
    variance: {
      label: "Stock variance",
      value: summary.stockVarianceValue.toFixed(2),
      tone: summary.stockVarianceValue > 0 ? "warning" : "default",
      explanation: "Unexplained variance from reconciliations in the last 30 days, after accounting for recorded sales and valid adjustments.",
    },
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(defs) as MetricKey[]).map((key) => (
          <Tile key={key} def={defs[key]} onClick={() => setOpenMetric(key)} />
        ))}
      </div>

      <Dialog open={openMetric !== null} onOpenChange={(open) => !open && setOpenMetric(null)}>
        <DialogContent>
          {openMetric && (
            <>
              <DialogHeader>
                <DialogTitle>{defs[openMetric].label}</DialogTitle>
                <DialogDescription>{defs[openMetric].explanation}</DialogDescription>
              </DialogHeader>

              {openMetric === "lowStock" &&
                (lowStock.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is currently low on stock.</p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {lowStock.map((row) => (
                      <Link
                        key={row.productId}
                        href={`/t/${tenantSlug}/stock/${row.productId}`}
                        className="flex items-center gap-3 rounded-lg border p-2 hover:bg-muted/50"
                      >
                        <ProductPhotoThumbnail imageUrl={row.imageUrl} productName={row.productName} showName={false} className="h-10 w-10 border" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.productName}</span>
                        <Badge variant="outline" className="shrink-0 tabular-nums">
                          {row.balance} {row.unitOfMeasure ?? ""}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                ))}

              {openMetric === "outOfStock" &&
                (outOfStock.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is currently out of stock.</p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {outOfStock.map((row) => (
                      <Link
                        key={row.productId}
                        href={`/t/${tenantSlug}/stock/${row.productId}`}
                        className="flex items-center gap-3 rounded-lg border p-2 hover:bg-muted/50"
                      >
                        <ProductPhotoThumbnail imageUrl={row.imageUrl} productName={row.productName} showName={false} className="h-10 w-10 border" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.productName}</span>
                        <Badge variant="destructive" className="shrink-0 tabular-nums">
                          {row.balance} {row.unitOfMeasure ?? ""}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                ))}

              {openMetric === "variance" &&
                (varianceReport.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reconciliation variances in the last 30 days.</p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {varianceReport.map((row) => {
                      const over = row.variance > 0;
                      return (
                        <div key={row.reconciliationId} className="rounded-lg border p-2">
                          <div className="flex items-baseline justify-between gap-2 text-sm">
                            <span className="truncate font-medium">{row.productName}</span>
                            <span className={`shrink-0 tabular-nums ${over ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                              {over ? "+" : ""}
                              {row.variance} {row.unitOfMeasure ?? ""}
                            </span>
                          </div>
                          {row.varianceReason && <p className="mt-0.5 text-xs text-muted-foreground">{row.varianceReason}</p>}
                        </div>
                      );
                    })}
                  </div>
                ))}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
