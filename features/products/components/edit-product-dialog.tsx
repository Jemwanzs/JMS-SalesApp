"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteProductAction } from "@/features/products/actions/delete-product";
import { removeProductImageAction } from "@/features/products/actions/remove-product-image";
import { setProductImageAction } from "@/features/products/actions/set-product-image";
import { updateProductAction } from "@/features/products/actions/update-product";
import {
  ProductImageUpload,
  type ProductImageValue,
} from "@/features/products/components/product-image-upload";
import { UnitOfMeasureSelect } from "@/features/products/components/unit-of-measure-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Product } from "@/services/ProductService";

export function EditProductDialog({
  product,
  tenantId,
  tenantSlug,
  canDelete,
  inventoryEnabled,
  onUpdated,
  onDeleted,
}: {
  product: Product;
  tenantId: string;
  tenantSlug: string;
  canDelete: boolean;
  /** Product Enhancements #3: hides the Inventory section entirely for a Sales-only tenant -- nothing to configure when the module isn't on. */
  inventoryEnabled: boolean;
  onUpdated: (product: Product) => void;
  onDeleted: (productId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [expectedPrice, setExpectedPrice] = useState(
    product.expectedPrice !== null ? String(product.expectedPrice) : "0"
  );
  const [image, setImage] = useState<ProductImageValue | null>(
    product.imageUrl ? { url: product.imageUrl, storagePath: "" } : null
  );
  const [showNameInPhotoView, setShowNameInPhotoView] = useState(product.showNameInPhotoView);
  const [tracksInventory, setTracksInventory] = useState(product.tracksInventory);
  const [costPrice, setCostPrice] = useState(product.costPrice !== null ? String(product.costPrice) : "");
  const [unitOfMeasure, setUnitOfMeasure] = useState(product.unitOfMeasure);
  const [unitOfMeasureIsCustom, setUnitOfMeasureIsCustom] = useState(product.unitOfMeasureIsCustom);
  const [lowStockThreshold, setLowStockThreshold] = useState(
    product.lowStockThreshold !== null ? String(product.lowStockThreshold) : ""
  );
  const [sku, setSku] = useState(product.sku ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isDirty =
    name !== product.name ||
    description !== (product.description ?? "") ||
    expectedPrice !== (product.expectedPrice !== null ? String(product.expectedPrice) : "0") ||
    showNameInPhotoView !== product.showNameInPhotoView ||
    tracksInventory !== product.tracksInventory ||
    costPrice !== (product.costPrice !== null ? String(product.costPrice) : "") ||
    unitOfMeasure !== product.unitOfMeasure ||
    unitOfMeasureIsCustom !== product.unitOfMeasureIsCustom ||
    sku !== (product.sku ?? "") ||
    lowStockThreshold !== (product.lowStockThreshold !== null ? String(product.lowStockThreshold) : "");

  function onDelete() {
    if (
      !window.confirm(
        `Permanently delete "${product.name}"? This cannot be undone. Only works if it has never been sold -- otherwise, use Archive instead.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteProductAction(tenantId, tenantSlug, product.id, product.name);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Product deleted");
      setOpen(false);
      onDeleted(product.id);
    });
  }

  function onImageChange(next: ProductImageValue | null) {
    setImage(next);
    startTransition(async () => {
      const result = next
        ? await setProductImageAction(tenantId, tenantSlug, product.id, next.storagePath, next.url)
        : await removeProductImageAction(tenantId, tenantSlug, product.id);

      if (result.error) {
        setError(result.error);
      }
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("productId", product.id);
    formData.set("name", name);
    formData.set("description", description);
    formData.set("expectedPrice", expectedPrice);
    formData.set("showExpectedPrice", String(product.showExpectedPrice));
    formData.set("showNameInPhotoView", String(showNameInPhotoView));
    if (inventoryEnabled) {
      formData.set("tracksInventory", String(tracksInventory));
      formData.set("costPrice", costPrice);
      formData.set("unitOfMeasure", unitOfMeasure ?? "");
      formData.set("unitOfMeasureIsCustom", String(unitOfMeasureIsCustom));
      formData.set("lowStockThreshold", lowStockThreshold);
      formData.set("sku", sku);
    }

    startTransition(async () => {
      const result = await updateProductAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
        return;
      }
      if (result.product) {
        toast.success("Product updated");
        setOpen(false);
        onUpdated({ ...result.product, imageUrl: image?.url ?? null });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Edit</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit product</DialogTitle>
        </DialogHeader>

        <ProductImageUpload
          tenantId={tenantId}
          productId={product.id}
          value={image}
          onChange={onImageChange}
        />

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Description (optional)</Label>
            <Input
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-price">Expected price</Label>
            <Input
              id="edit-price"
              type="number"
              min="0"
              step="0.01"
              value={expectedPrice}
              onChange={(e) => setExpectedPrice(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-show-name-in-photo" className="font-normal">
              Show product name when photo is viewed enlarged
            </Label>
            <Switch
              id="edit-show-name-in-photo"
              checked={showNameInPhotoView}
              onCheckedChange={setShowNameInPhotoView}
            />
          </div>

          {inventoryEnabled && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="edit-track-inventory" className="font-normal">
                  Track inventory for this product
                </Label>
                <Switch id="edit-track-inventory" checked={tracksInventory} onCheckedChange={setTracksInventory} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-sku">SKU / barcode (optional)</Label>
                <Input id="edit-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="For future barcode scanning" />
              </div>
              {tracksInventory && (
                <>
                  <UnitOfMeasureSelect
                    value={unitOfMeasure}
                    isCustom={unitOfMeasureIsCustom}
                    onChange={(value, isCustom) => {
                      setUnitOfMeasure(value);
                      setUnitOfMeasureIsCustom(isCustom);
                    }}
                  />
                  <div className="space-y-2">
                    <Label htmlFor="edit-low-stock">Low stock alert threshold (optional)</Label>
                    <Input
                      id="edit-low-stock"
                      type="number"
                      min="0"
                      step="0.001"
                      value={lowStockThreshold}
                      onChange={(e) => setLowStockThreshold(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-cost-price">Cost price (optional)</Label>
                    <Input
                      id="edit-cost-price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={costPrice}
                      onChange={(e) => setCostPrice(e.target.value)}
                      placeholder="What this costs you per unit"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            {canDelete && (
              <Button type="button" variant="destructive" disabled={isPending} onClick={onDelete}>
                Delete product
              </Button>
            )}
            <Button type="submit" disabled={isPending || !isDirty}>
              {isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
