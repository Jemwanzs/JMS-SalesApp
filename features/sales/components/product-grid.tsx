"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { RecordSaleSheet } from "@/features/sales/components/record-sale-sheet";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import type { Product } from "@/services/ProductService";
import type { RecordSaleState } from "@/features/sales/actions/record-sale";

/**
 * Product list + the record-sale bottom sheet (spec S14-S18: tap
 * product -> enter amount -> Record Sale -> confirmation -> back to
 * Capture Sales, no intermediate navigation -- closing the sheet IS
 * "back to Capture Sales" since we never left this screen).
 *
 * Row layout (image + name/description, price, a dedicated tap target)
 * replaced the earlier 2-column square-card grid -- denser and faster to
 * scan for a longer catalog, borrowed from a marketplace-app reference
 * the user shared rather than invented from scratch. Deliberately left
 * behind from that reference: category tabs, discount badges, promo
 * carousels -- none of it maps to this schema (no product categories or
 * discount pricing yet) or to a staff POS flow (no browsing/cart), so
 * only the list-row legibility pattern itself was worth adopting.
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
      <div className="divide-y">
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
            className="flex cursor-pointer items-center gap-3 p-4 text-left transition-colors hover:bg-muted active:bg-muted"
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
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{product.name}</p>
              {product.description && (
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {product.description}
                </p>
              )}
              {product.showExpectedPrice && product.expectedPrice !== null && (
                <p className="mt-0.5 text-sm font-medium tabular-nums">
                  {product.expectedPrice.toFixed(2)}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label={`Record a sale for ${product.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(product);
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/80"
            >
              <Plus className="h-4 w-4" />
            </button>
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
