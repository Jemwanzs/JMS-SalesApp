"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { archiveProductAction } from "@/features/products/actions/archive-product";
import { setProductStatusAction } from "@/features/products/actions/set-product-status";
import { EditProductDialog } from "@/features/products/components/edit-product-dialog";
import { ProductPhotoThumbnail } from "@/features/products/components/product-photo-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Product } from "@/services/ProductService";

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

  function onUpdated(updated: Product) {
    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
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

  if (items.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        No products yet. Add your first one above.
      </p>
    );
  }

  return (
    <div className="mt-6 divide-y rounded-lg border">
      {items.map((product) => (
        <div key={product.id} className="flex items-center gap-3 p-3">
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
                  onUpdated={onUpdated}
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
  );
}
