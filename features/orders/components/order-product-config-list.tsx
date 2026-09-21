"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Package } from "lucide-react";

import { bulkSetOrderProductAvailabilityAction } from "@/features/orders/actions/bulk-set-order-product-availability";
import { saveOrderProductMinimumsAction } from "@/features/orders/actions/save-order-product-minimums";
import { setOrderProductAvailabilityAction } from "@/features/orders/actions/set-order-product-availability";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { OrderableProduct } from "@/services/OrderProductService";

/**
 * One row per product already in the tenant's real Products catalogue
 * -- no separate Order Products entry/photo-upload flow anymore (spec:
 * "Do not require the tenant to recreate products specifically for
 * Orders"). Ordering ON/OFF saves instantly per row (matches this
 * app's established Switch convention); Select All/Deselect All is one
 * bulk call, not N individual ones; Minimum Order amounts are typed
 * locally and committed together via one "Save Changes" button, so
 * nothing saves on a half-typed number. All three confirmed with the
 * user before building this.
 */
export function OrderProductConfigList({
  tenantId,
  tenantSlug,
  products,
}: {
  tenantId: string;
  tenantSlug: string;
  products: OrderableProduct[];
}) {
  const [availability, setAvailability] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(products.map((p) => [p.productId, p.isAvailable]))
  );
  const [minimums, setMinimums] = useState<Record<string, string>>(() =>
    Object.fromEntries(products.map((p) => [p.productId, String(p.minimumOrderAmount)]))
  );
  const [isBulkPending, startBulkTransition] = useTransition();
  const [isSavePending, startSaveTransition] = useTransition();

  const dirtyProductIds = useMemo(
    () => products.filter((p) => Number(minimums[p.productId]) !== p.minimumOrderAmount).map((p) => p.productId),
    [products, minimums]
  );

  function onToggleOne(productId: string, next: boolean) {
    const previous = availability[productId];
    setAvailability((prev) => ({ ...prev, [productId]: next }));
    startBulkTransition(async () => {
      const result = await setOrderProductAvailabilityAction(tenantId, tenantSlug, productId, next);
      if (result.error) {
        setAvailability((prev) => ({ ...prev, [productId]: previous }));
        toast.error(result.error);
      }
    });
  }

  function onBulkToggle(next: boolean) {
    const previous = { ...availability };
    setAvailability(Object.fromEntries(products.map((p) => [p.productId, next])));
    startBulkTransition(async () => {
      const result = await bulkSetOrderProductAvailabilityAction(
        tenantId,
        tenantSlug,
        products.map((p) => p.productId),
        next
      );
      if (result.error) {
        setAvailability(previous);
        toast.error(result.error);
        return;
      }
      toast.success(next ? "All products enabled for ordering" : "All products disabled for ordering");
    });
  }

  function onSaveMinimums() {
    const entries = dirtyProductIds.map((productId) => ({ productId, minimumOrderAmount: Number(minimums[productId]) }));
    startSaveTransition(async () => {
      const result = await saveOrderProductMinimumsAction(tenantId, tenantSlug, entries);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Minimum order values saved");
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex gap-2">
        <Button type="button" variant="outline" size="sm" disabled={isBulkPending} onClick={() => onBulkToggle(true)}>
          Select All
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={isBulkPending} onClick={() => onBulkToggle(false)}>
          Deselect All
        </Button>
      </div>

      <div className="divide-y rounded-lg border">
        <div className="flex items-center justify-between gap-3 bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Product</span>
          <div className="flex items-center gap-4">
            <span className="w-14 text-center">Ordering</span>
            <span className="w-24 text-right">Minimum</span>
          </div>
        </div>
        {products.map((product) => (
          <div key={product.productId} className="flex items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                {product.imageUrl ? (
                  <Image src={product.imageUrl} alt="" width={36} height={36} className="h-full w-full object-cover" />
                ) : (
                  <Package className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <span className="truncate text-sm">{product.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="flex w-14 items-center justify-center">
                <Switch
                  checked={availability[product.productId]}
                  disabled={isBulkPending}
                  onCheckedChange={(next) => onToggleOne(product.productId, next)}
                  aria-label={`Available for ordering: ${product.name}`}
                />
              </div>
              <Input
                type="number"
                min="0"
                step="0.01"
                className="w-24 text-right"
                value={minimums[product.productId]}
                onChange={(e) => setMinimums((prev) => ({ ...prev, [product.productId]: e.target.value }))}
                disabled={isSavePending}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 mt-4 flex justify-end bg-background pb-2 pt-2">
        <Button type="button" onClick={onSaveMinimums} disabled={isSavePending || dirtyProductIds.length === 0}>
          {isSavePending ? "Saving..." : `Save Changes${dirtyProductIds.length > 0 ? ` (${dirtyProductIds.length})` : ""}`}
        </Button>
      </div>
    </div>
  );
}
