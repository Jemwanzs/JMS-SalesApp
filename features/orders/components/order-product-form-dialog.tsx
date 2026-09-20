"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { createOrderProductAction } from "@/features/orders/actions/create-order-product";
import { updateOrderProductAction } from "@/features/orders/actions/update-order-product";
import { OrderProductImageUpload } from "@/features/orders/components/order-product-image-upload";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { OrderProduct } from "@/services/OrderProductService";

/**
 * One dialog for both Add and Edit, same "mode driven by which record
 * is selected" idiom as ExpenseItemFormDialog. Image upload only shows
 * in Edit mode -- see order-product-image-upload.tsx's own header
 * comment for why (Add saves the text fields first, then the dialog
 * re-opens in Edit mode with a real id to attach a photo to).
 */
export function OrderProductFormDialog({
  tenantId,
  tenantSlug,
  open,
  onOpenChange,
  editingProduct,
}: {
  tenantId: string;
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingProduct: OrderProduct | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minimumOrderAmount, setMinimumOrderAmount] = useState("");
  const [isAvailable, setIsAvailable] = useState(true);
  const [displayOrder, setDisplayOrder] = useState("0");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingProduct?.name ?? "");
    setDescription(editingProduct?.description ?? "");
    setMinimumOrderAmount(editingProduct?.minimumOrderAmount != null ? String(editingProduct.minimumOrderAmount) : "");
    setIsAvailable(editingProduct?.isAvailable ?? true);
    setDisplayOrder(editingProduct?.displayOrder != null ? String(editingProduct.displayOrder) : "0");
    setError(null);
  }, [open, editingProduct]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("description", description);
    formData.set("minimumOrderAmount", minimumOrderAmount);
    formData.set("isAvailable", String(isAvailable));
    formData.set("displayOrder", displayOrder);
    if (editingProduct) {
      formData.set("orderProductId", editingProduct.id);
    }

    startTransition(async () => {
      const result = editingProduct
        ? await updateOrderProductAction(tenantId, tenantSlug, {}, formData)
        : await createOrderProductAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success(editingProduct ? "Product updated" : "Product added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingProduct ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>
            {editingProduct ? "All fields stay editable after creation." : "Only active + available products appear on the public ordering page."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="order-product-name">Product name</Label>
            <Input id="order-product-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fresh Tomatoes" autoFocus required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-product-description">Description (optional)</Label>
            <Input id="order-product-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-product-minimum">Minimum order amount</Label>
            <Input
              id="order-product-minimum"
              type="number"
              min="0"
              step="0.01"
              value={minimumOrderAmount}
              onChange={(e) => setMinimumOrderAmount(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="order-product-display-order">Display order</Label>
            <Input id="order-product-display-order" type="number" step="1" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="order-product-available" className="font-normal text-muted-foreground">
              Available for ordering right now
            </Label>
            <Switch id="order-product-available" checked={isAvailable} onCheckedChange={setIsAvailable} />
          </div>

          {editingProduct && (
            <div className="space-y-2">
              <Label>Photo</Label>
              <OrderProductImageUpload
                tenantId={tenantId}
                tenantSlug={tenantSlug}
                orderProductId={editingProduct.id}
                imageUrl={editingProduct.imageUrl}
                imageStoragePath={editingProduct.imageStoragePath}
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Saving..." : editingProduct ? "Save changes" : "Add product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
