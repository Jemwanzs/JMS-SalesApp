"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Search, ShoppingCart } from "lucide-react";

import { ProductOrderDialog } from "@/features/public-ordering/components/product-order-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CartLine } from "@/features/public-ordering/components/ordering-storefront";
import { readCookieConsent } from "@/lib/consent/cookie-consent";
import type { StorefrontProduct } from "@/services/PublicOrderingService";

/** Search + product rows, mirroring ProductGrid's own row/search shape (features/sales/components/product-grid.tsx) -- the tenant app's own Capture Sales list, same visual language for a customer-facing catalogue. */
export function ProductList({
  products,
  cart,
  onAddToCart,
  cartCount,
  cartTotal,
  onViewCart,
}: {
  products: StorefrontProduct[];
  cart: CartLine[];
  onAddToCart: (line: CartLine) => void;
  cartCount: number;
  cartTotal: number;
  onViewCart: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<StorefrontProduct | null>(null);
  // CookieConsentBanner (mounted globally, app/layout.tsx) is `fixed
  // bottom-0 z-50` and shows for any visitor with no consent choice on
  // file yet -- extremely common on a public storefront reached via a
  // freshly-clicked share link, more so than on the authenticated app
  // where returning staff already dismissed it long ago. Without
  // checking this, our own cart bar (also fixed-to-bottom) would sit
  // underneath it and be genuinely unclickable for a first-time
  // visitor. Checked once on mount; doesn't need to react to the
  // banner being dismissed mid-visit (writeCookieConsent emits no
  // event to listen for) -- a slightly larger-than-necessary gap for
  // the rest of that page view is a trivial cosmetic cost next to the
  // bug this avoids.
  const [reserveBannerSpace, setReserveBannerSpace] = useState(false);

  useEffect(() => {
    setReserveBannerSpace(readCookieConsent() === null);
  }, []);

  const visibleProducts = search.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()))
    : products;

  const cartByProductId = new Map(cart.map((l) => [l.orderProductId, l]));

  return (
    <div className="flex flex-1 flex-col pb-20">
      <div className="relative p-3">
        <Search className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." className="pl-9" />
      </div>

      {products.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          Ordering is currently unavailable. Please check again shortly or contact us for assistance.
        </p>
      )}
      {products.length > 0 && visibleProducts.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">
          No products found for &quot;{search}&quot;.
          <br />
          Try searching for another product.
        </p>
      )}

      <div className="divide-y">
        {visibleProducts.map((product) => {
          const inCart = cartByProductId.get(product.id);
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => setSelectedProduct(product)}
              className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted active:bg-muted"
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                {product.imageUrl && <Image src={product.imageUrl} alt="" width={56} height={56} className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{product.name}</p>
                <p className="text-sm text-muted-foreground">Min {product.minimumOrderAmount.toFixed(2)}</p>
                {inCart && <p className="text-xs font-medium text-primary">In cart: {inCart.requestedAmount.toFixed(2)}</p>}
              </div>
              <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                {inCart ? "Edit" : "Order"}
              </span>
            </button>
          );
        })}
      </div>

      <ProductOrderDialog
        product={selectedProduct}
        existingLine={selectedProduct ? (cartByProductId.get(selectedProduct.id) ?? null) : null}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        onAdd={onAddToCart}
      />

      {cartCount > 0 && (
        <div
          className={`fixed left-1/2 w-full max-w-[430px] -translate-x-1/2 border-t bg-background p-3 ${reserveBannerSpace ? "bottom-[132px]" : "bottom-0"}`}
        >
          <Button type="button" className="w-full" onClick={onViewCart}>
            <ShoppingCart className="h-4 w-4" />
            Cart ({cartCount}) &middot; {cartTotal.toFixed(2)}
          </Button>
        </div>
      )}
    </div>
  );
}
