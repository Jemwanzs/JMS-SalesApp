"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { QuickStockEntryDialog } from "@/features/stock/components/quick-stock-entry-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import type { RecordableMovementType, StockBalanceRow } from "@/services/StockService";

/**
 * Shared shell for the Stock In and Adjust tabs -- both are "pick a
 * tracked product, then pick which of a curated set of movement types
 * applies" flows, reusing the exact same QuickStockEntryDialog every
 * per-product quick action already uses (see stock-product-detail.tsx),
 * just entered from a tenant-wide product list instead of a single
 * product's own page.
 */
export function StockActionList({
  tenantId,
  tenantSlug,
  balances,
  actions,
  emptyLabel,
}: {
  tenantId: string;
  tenantSlug: string;
  balances: StockBalanceRow[];
  actions: { type: RecordableMovementType; label: string }[];
  emptyLabel: string;
}) {
  const [search, setSearch] = useState("");
  const [pickerProduct, setPickerProduct] = useState<StockBalanceRow | null>(null);
  const [activeProduct, setActiveProduct] = useState<StockBalanceRow | null>(null);
  const [activeType, setActiveType] = useState<RecordableMovementType | null>(null);

  const filtered = balances.filter((b) => b.productName.toLowerCase().includes(search.toLowerCase()));

  function onPick(row: StockBalanceRow) {
    if (actions.length === 1) {
      setActiveProduct(row);
      setActiveType(actions[0].type);
    } else {
      setPickerProduct(row);
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products" className="pl-9" />
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">{balances.length === 0 ? emptyLabel : "No products match your search."}</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {filtered.map((row) => (
            <button
              key={row.productId}
              type="button"
              onClick={() => onPick(row)}
              className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/50"
            >
              <ProductPhotoThumbnail imageUrl={row.imageUrl} productName={row.productName} showName={false} className="h-12 w-12 border" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.productName}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {row.balance} {row.unitOfMeasure ?? "units"}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Dialog open={pickerProduct !== null} onOpenChange={(open) => !open && setPickerProduct(null)}>
        <DialogContent>
          {pickerProduct && (
            <>
              <DialogHeader>
                <DialogTitle>{pickerProduct.productName}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-2">
                {actions.map((action) => (
                  <button
                    key={action.type}
                    type="button"
                    className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
                    onClick={() => {
                      setActiveProduct(pickerProduct);
                      setActiveType(action.type);
                      setPickerProduct(null);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <QuickStockEntryDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        productId={activeProduct?.productId ?? ""}
        productName={activeProduct?.productName ?? ""}
        unitOfMeasure={activeProduct?.unitOfMeasure ?? null}
        movementType={activeProduct ? activeType : null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveType(null);
            setActiveProduct(null);
          }
        }}
      />
    </div>
  );
}
