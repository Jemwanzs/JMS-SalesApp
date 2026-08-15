"use client";

import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";

import { RecordSaleSheet } from "@/features/sales/components/record-sale-sheet";
import type { Product } from "@/services/ProductService";
import type { RecordSaleState } from "@/features/sales/actions/record-sale";

/**
 * Product cards + the record-sale bottom sheet (spec S14-S18: tap
 * product -> enter amount -> Record Sale -> confirmation -> back to
 * Capture Sales, no intermediate navigation -- closing the sheet IS
 * "back to Capture Sales" since we never left this screen).
 */
export function ProductGrid({
  products,
  tenantId,
  tenantSlug,
  locationId,
  businessDayId,
}: {
  products: Product[];
  tenantId: string;
  tenantSlug: string;
  locationId: string;
  businessDayId: string;
}) {
  const [selected, setSelected] = useState<Product | null>(null);

  function onRecorded(sale: NonNullable<RecordSaleState["sale"]>) {
    setSelected(null);
    toast.success("Sale Recorded", {
      description: `${sale.actualAmount.toFixed(2)} · ${sale.productNameSnapshot}${
        sale.saleNumber ? ` · ${sale.saleNumber}` : ""
      }${sale.replayed ? " (already recorded)" : ""}`,
    });
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No products yet. Add some from More → Products.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 p-4">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => setSelected(product)}
            className="flex flex-col items-start overflow-hidden rounded-lg border text-left transition-colors hover:bg-muted"
          >
            <div className="flex h-24 w-full items-center justify-center bg-muted">
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  width={200}
                  height={200}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : (
                <span className="text-2xl">🛒</span>
              )}
            </div>
            <div className="w-full p-2">
              <p className="truncate text-sm font-medium">{product.name}</p>
              {product.showExpectedPrice && product.expectedPrice !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {product.expectedPrice.toFixed(2)}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      <RecordSaleSheet
        product={selected}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        locationId={locationId}
        businessDayId={businessDayId}
        onOpenChange={(open) => !open && setSelected(null)}
        onRecorded={onRecorded}
      />
    </>
  );
}
