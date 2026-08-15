"use client";

import { useState } from "react";
import { toast } from "sonner";

import { RecordSaleSheet } from "@/features/sales/components/record-sale-sheet";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
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
          <div
            key={product.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(product)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(product);
              }
            }}
            className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2 text-center transition-colors hover:bg-muted"
          >
            {/* ProductPhotoThumbnail's own "view photo" button is a
                sibling target inside this div, not nested in another
                button -- see product-photo-viewer.tsx's stopPropagation
                note. */}
            <ProductPhotoThumbnail
              imageUrl={product.imageUrl}
              productName={product.name}
              showName={product.showNameInPhotoView}
            />
            <div className="w-full">
              <p className="truncate text-sm font-medium">{product.name}</p>
              {product.showExpectedPrice && product.expectedPrice !== null && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {product.expectedPrice.toFixed(2)}
                </p>
              )}
            </div>
          </div>
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
