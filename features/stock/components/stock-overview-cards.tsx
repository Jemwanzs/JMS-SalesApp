"use client";

import { useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import type { StockBalanceRow, StockDailyOverviewSummary } from "@/services/StockService";

type MainCardKey = "current" | "opening" | "new" | "closing" | "adjusted" | "expectedSales" | "actualSales" | "variance";
type StatusCardKey = "tracked" | "lowStock" | "outOfStock";

interface CardDef {
  label: string;
  value: string;
  tone?: "default" | "warning" | "destructive";
  explanation: string;
}

function Tile({ def, onClick }: { def: CardDef; onClick?: () => void }) {
  const body = (
    <Card size="sm" className={`h-full ${onClick ? "cursor-pointer transition-shadow hover:border-primary/50 hover:shadow-md" : ""}`}>
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
  );

  if (!onClick) return body;
  return (
    <button type="button" onClick={onClick} className="text-left transition-transform hover:-translate-y-0.5 active:translate-y-0">
      {body}
    </button>
  );
}

/**
 * The Overview's redesigned card set (Product Enhancements: "Inventory
 * Module — Configuration & Stock Overview Enhancements"). Two visually
 * separate groups, deliberately not blended into one grid:
 *
 * 1. The main stock cards, in the exact order specified, switching
 *    between quantity and currency for the first five depending on the
 *    tenant's stock_control_method -- Expected/Actual Sales and their
 *    Variance stay in currency regardless of method, since a "sale" is
 *    always a monetary event.
 * 2. A clear visual break, then product-STATUS counts (Tracked/Low/Out
 *    of stock) -- deliberately never mixed into the stock-value KPI
 *    group above, and never date-filtered (a live/current-state concept
 *    only -- you can't retroactively know a past day's low-stock state
 *    from today's threshold).
 */
export function StockOverviewCards({
  summary,
  stockControlMethod,
  balances,
  lowStock,
  tenantSlug,
}: {
  summary: StockDailyOverviewSummary;
  stockControlMethod: "quantity" | "value";
  balances: StockBalanceRow[];
  lowStock: StockBalanceRow[];
  tenantSlug: string;
}) {
  const [openMain, setOpenMain] = useState<MainCardKey | null>(null);
  const [openStatus, setOpenStatus] = useState<StatusCardKey | null>(null);
  const byQuantity = stockControlMethod === "quantity";
  const outOfStock = balances.filter((b) => b.balance <= 0);
  const hasLowOrOut = summary.lowStockCount > 0 || summary.outOfStockCount > 0;

  const fmt = (n: number) => n.toFixed(byQuantity ? 0 : 2);

  const mainDefs: Record<MainCardKey, CardDef> = {
    current: {
      label: "Current Stock",
      value: fmt(byQuantity ? summary.currentStockQuantity : summary.currentStockValue),
      tone: hasLowOrOut ? "destructive" : "default",
      explanation: byQuantity
        ? "Total units on hand right now, across every tracked product. Turns red when at least one product is low or out of stock."
        : "Total stock value on hand right now (balance × cost price), across every tracked product. Turns red when at least one product is low or out of stock.",
    },
    opening: {
      label: "Opening Stock",
      value: fmt(byQuantity ? summary.openingStockQuantity : summary.openingStockValue),
      explanation: `Stock on hand at the start of ${summary.date}, carried over from every movement before that date.`,
    },
    new: {
      label: "New Stock",
      value: fmt(byQuantity ? summary.newStockQuantity : summary.newStockValue),
      explanation: `Opening Stock and Stock In movements recorded on ${summary.date}.`,
    },
    closing: {
      label: "Closing Stock",
      value: fmt(byQuantity ? summary.closingStockQuantity : summary.closingStockValue),
      explanation: "Opening Stock + New Stock − Stock Sold ± Stock Adjustments, for this date.",
    },
    adjusted: {
      label: "Stock Adjusted",
      value: fmt(byQuantity ? summary.adjustedQuantity : summary.adjustedValue),
      explanation: "Net of damages, losses, expiry, manual adjustments, and reconciliation corrections recorded on this date.",
    },
    expectedSales: {
      label: "Expected Sales",
      value: summary.expectedSalesValue.toFixed(2),
      explanation: "Opening Stock Value + New Stock Value -- what the stock available on this date would sell for if all of it moved.",
    },
    actualSales: {
      // Deliberately scoped to tracked products only -- a sale recorded
      // through the free-text "Others" catch-all has no stock ledger to
      // compare against (it can never be tracks_inventory), so including
      // it here would make Variance meaningless for real stock analysis.
      // Labeled explicitly so this never reads as a mismatch against the
      // business's overall sales total shown elsewhere (Reports/
      // Analytics/Sales History) -- it's a real, permanent subset, not a
      // bug when the two numbers differ.
      label: "Actual Sales (Tracked)",
      value: summary.actualSalesValue.toFixed(2),
      explanation: "Real recorded revenue (excluding voided/corrected sales) for TRACKED products only, on this date -- a sale of an untracked or \"Others\" free-text product isn't included, since there's no stock movement to compare it against. The business's overall sales total (Reports/Analytics/Sales History) can be higher than this figure; that's expected, not a mismatch.",
    },
    variance: {
      label: "Variance (Tracked)",
      value: summary.varianceValue.toFixed(2),
      tone: Math.abs(summary.varianceValue) > 0 ? "warning" : "default",
      explanation: "Expected Sales − Actual Sales, both scoped to tracked products. A positive figure is stock that should have sold but didn't yet (or was lost/adjusted) -- check Reconcile for the per-product breakdown.",
    },
  };

  const statusDefs: Record<StatusCardKey, CardDef> = {
    tracked: {
      label: "Products Tracked",
      value: String(summary.productsTracked),
      explanation: "Active products with stock tracking turned on (Products → edit → Track inventory).",
    },
    lowStock: {
      label: "Low Stock Products",
      value: String(summary.lowStockCount),
      tone: summary.lowStockCount > 0 ? "warning" : "default",
      explanation: "Tracked products at or below their own configured low-stock alert threshold, but not yet at zero.",
    },
    outOfStock: {
      label: "Out of Stock Products",
      value: String(summary.outOfStockCount),
      tone: summary.outOfStockCount > 0 ? "destructive" : "default",
      explanation: "Tracked products whose current balance has reached zero or below.",
    },
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {(Object.keys(mainDefs) as MainCardKey[]).map((key) => (
          <Tile key={key} def={mainDefs[key]} onClick={() => setOpenMain(key)} />
        ))}
      </div>

      <div className="my-2 border-t" />

      <div className="grid grid-cols-3 gap-3">
        {(Object.keys(statusDefs) as StatusCardKey[]).map((key) => (
          <Tile key={key} def={statusDefs[key]} onClick={() => setOpenStatus(key)} />
        ))}
      </div>

      <Dialog open={openMain !== null} onOpenChange={(open) => !open && setOpenMain(null)}>
        <DialogContent>
          {openMain && (
            <DialogHeader>
              <DialogTitle>{mainDefs[openMain].label}</DialogTitle>
              <DialogDescription>{mainDefs[openMain].explanation}</DialogDescription>
            </DialogHeader>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openStatus !== null} onOpenChange={(open) => !open && setOpenStatus(null)}>
        <DialogContent>
          {openStatus && (
            <>
              <DialogHeader>
                <DialogTitle>{statusDefs[openStatus].label}</DialogTitle>
                <DialogDescription>{statusDefs[openStatus].explanation}</DialogDescription>
              </DialogHeader>

              {openStatus === "lowStock" &&
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

              {openStatus === "outOfStock" &&
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
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
