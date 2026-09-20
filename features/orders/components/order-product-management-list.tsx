"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { setOrderProductStatusAction } from "@/features/orders/actions/archive-order-product";
import { OrderProductFormDialog } from "@/features/orders/components/order-product-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OrderProduct } from "@/services/OrderProductService";

export function OrderProductManagementList({
  tenantId,
  tenantSlug,
  orderProducts,
}: {
  tenantId: string;
  tenantSlug: string;
  orderProducts: OrderProduct[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<OrderProduct | null>(null);
  const [isPending, startTransition] = useTransition();

  function openAdd() {
    setEditingProduct(null);
    setDialogOpen(true);
  }
  function openEdit(product: OrderProduct) {
    setEditingProduct(product);
    setDialogOpen(true);
  }
  function toggleStatus(product: OrderProduct) {
    startTransition(async () => {
      const result = await setOrderProductStatusAction(
        tenantId,
        tenantSlug,
        product.id,
        product.status === "active" ? "archived" : "active"
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(product.status === "active" ? "Archived" : "Reactivated");
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Button onClick={openAdd} className="w-full">
        <Plus className="h-4 w-4" />
        Add product
      </Button>

      {orderProducts.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No order products configured yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {orderProducts.map((product) => (
            <div key={product.id} className="flex items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => openEdit(product)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{product.name}</p>
                  {!product.isAvailable && (
                    <Badge variant="outline" className="shrink-0">
                      Unavailable
                    </Badge>
                  )}
                  {product.status === "archived" && (
                    <Badge variant="secondary" className="shrink-0">
                      Archived
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">Minimum order: {product.minimumOrderAmount.toFixed(2)}</p>
              </button>
              <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => toggleStatus(product)}>
                {product.status === "active" ? "Archive" : "Reactivate"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <OrderProductFormDialog tenantId={tenantId} tenantSlug={tenantSlug} open={dialogOpen} onOpenChange={setDialogOpen} editingProduct={editingProduct} />
    </div>
  );
}
