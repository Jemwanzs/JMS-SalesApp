"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

import { archiveProductAction } from "@/features/products/actions/archive-product";
import { reorderProductsAction } from "@/features/products/actions/reorder-products";
import { setProductStatusAction } from "@/features/products/actions/set-product-status";
import { AddProductForm } from "@/features/products/components/add-product-form";
import { EditProductDialog } from "@/features/products/components/edit-product-dialog";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Product } from "@/services/ProductService";

/**
 * Reordering (spec S45's other half, alongside bulk upload) ships as
 * Move Up/Down buttons rather than press-and-drag -- a real drag
 * gesture competes with vertical scrolling on the ~430px mobile
 * viewport this whole app targets (docs/00's "mobile-first, always"
 * principle) and would also mean pulling in a new dependency for a
 * worse touch UX than two taps. Each move optimistically swaps the two
 * affected rows locally, then persists the full new order via
 * ProductService.reorder() (display_order = index in the given list);
 * a failed save reverts the optimistic swap rather than leaving the UI
 * and server disagreeing about the order.
 */
export function ProductManagementList({
  products,
  tenantId,
  tenantSlug,
  canEdit,
  canArchive,
}: {
  products: Product[];
  tenantId: string;
  tenantSlug: string;
  canEdit: boolean;
  canArchive: boolean;
}) {
  const [items, setItems] = useState(products);
  const [isPending, startTransition] = useTransition();

  function onMove(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const reordered = [...items];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];

    setItems(reordered);
    startTransition(async () => {
      const result = await reorderProductsAction(tenantId, tenantSlug, reordered.map((p) => p.id));
      if (result.error) {
        setItems(items); // revert the optimistic swap
        toast.error(result.error);
      }
    });
  }

  function onUpdated(updated: Product) {
    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  function onCreated(created: Product) {
    setItems((prev) => [...prev, created]);
  }

  function onDeleted(productId: string) {
    setItems((prev) => prev.filter((p) => p.id !== productId));
  }

  function onToggleStatus(product: Product) {
    const nextStatus = product.status === "active" ? "inactive" : "active";
    const formData = new FormData();
    formData.set("productId", product.id);
    formData.set("status", nextStatus);

    startTransition(async () => {
      const result = await setProductStatusAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setItems((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, status: nextStatus } : p))
      );
      toast.success(nextStatus === "active" ? "Product activated" : "Product deactivated");
    });
  }

  function onArchive(product: Product) {
    if (!window.confirm(`Archive "${product.name}"? It will be removed from the catalog.`)) {
      return;
    }

    startTransition(async () => {
      try {
        await archiveProductAction(tenantId, tenantSlug, product.id);
        setItems((prev) => prev.filter((p) => p.id !== product.id));
        toast.success("Product archived");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not archive product");
      }
    });
  }

  return (
    <>
      <AddProductForm tenantId={tenantId} tenantSlug={tenantSlug} onCreated={onCreated} />

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No products yet. Add your first one above.
        </p>
      ) : (
        <div className="mt-6 divide-y rounded-lg border">
          {items.map((product, index) => (
        <div key={product.id} className="flex items-center gap-3 p-3">
          {canEdit && (
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                aria-label="Move up"
                disabled={index === 0 || isPending}
                onClick={() => onMove(index, -1)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Move down"
                disabled={index === items.length - 1 || isPending}
                onClick={() => onMove(index, 1)}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          )}
          <ProductPhotoThumbnail
            imageUrl={product.imageUrl}
            productName={product.name}
            showName={product.showNameInPhotoView}
            className="border"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium">{product.name}</p>
              <Badge variant={product.status === "active" ? "default" : "secondary"}>
                {product.status}
              </Badge>
            </div>
            {product.expectedPrice !== null && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {product.expectedPrice.toFixed(2)}
              </p>
            )}
          </div>

          {(canEdit || canArchive) && (
            <div className="flex shrink-0 gap-2">
              {canEdit && (
                <EditProductDialog
                  product={product}
                  tenantId={tenantId}
                  tenantSlug={tenantSlug}
                  canDelete={canArchive}
                  onUpdated={onUpdated}
                  onDeleted={onDeleted}
                />
              )}
              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onToggleStatus(product)}
                >
                  {product.status === "active" ? "Deactivate" : "Activate"}
                </Button>
              )}
              {canArchive && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onArchive(product)}
                >
                  Archive
                </Button>
              )}
            </div>
          )}
        </div>
          ))}
        </div>
      )}
    </>
  );
}
