"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Search } from "lucide-react";

import { RecordSaleDialog } from "@/features/sales/components/record-sale-dialog";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { ProductTier } from "@/lib/utils/product-ranking";
import type { Product } from "@/services/ProductService";
import type { RecordSaleState } from "@/features/sales/actions/record-sale";

const TIER_LABEL: Record<ProductTier, string> = {
  gold: "🥇 Gold",
  silver: "🥈 Silver",
  bronze: "🥉 Bronze",
};

const TIER_BADGE_CLASS: Record<ProductTier, string> = {
  gold: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  silver: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  bronze: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-200",
};

/**
 * Product list + the record-sale dialog (spec S14-S18: tap product ->
 * enter amount -> Record Sale -> confirmation -> back to Capture Sales,
 * no intermediate navigation -- closing the dialog IS "back to Capture
 * Sales" since we never left this screen). The dialog was a bottom sheet
 * until item 7's fix -- centered now, see record-sale-dialog.tsx.
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
  showDailyVolume = false,
  todayRevenue,
  showProductPrice = true,
  quantityEnabled = true,
  tenantId,
  tenantSlug,
  locationId,
  businessDayId,
}: {
  products: (Product & { tier?: ProductTier | null })[];
  showDailyVolume?: boolean;
  todayRevenue?: Map<string, number>;
  showProductPrice?: boolean;
  quantityEnabled?: boolean;
  tenantId: string;
  tenantSlug: string;
  locationId: string;
  businessDayId: string;
}) {
  const [selected, setSelected] = useState<Product | null>(null);
  const [search, setSearch] = useState("");

  const visibleProducts = search.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : products;

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
      <div className="relative p-3">
        <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products"
          className="pl-9"
        />
      </div>

      {visibleProducts.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">No products match &quot;{search}&quot;.</p>
      )}

      <div className="divide-y">
        {visibleProducts.map((product) => (
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
              <div className="flex items-center gap-2">
                <p className="truncate font-medium">{product.name}</p>
                {product.tier && (
                  <Badge className={`shrink-0 ${TIER_BADGE_CLASS[product.tier]}`}>
                    {TIER_LABEL[product.tier]}
                  </Badge>
                )}
              </div>
              {product.description && (
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {product.description}
                </p>
              )}
              {showProductPrice && product.showExpectedPrice && product.expectedPrice !== null && (
                <p className="mt-0.5 text-sm font-medium tabular-nums">
                  {product.expectedPrice.toFixed(2)}
                </p>
              )}
              {showDailyVolume && (todayRevenue?.get(product.id) ?? 0) > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {todayRevenue!.get(product.id)!.toFixed(2)} today
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

      <RecordSaleDialog
        product={selected}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        locationId={locationId}
        businessDayId={businessDayId}
        quantityEnabled={quantityEnabled}
        onOpenChange={(open) => !open && setSelected(null)}
        onRecorded={onRecorded}
      />
    </>
  );
}
