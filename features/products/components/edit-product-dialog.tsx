"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { removeProductImageAction } from "@/features/products/actions/remove-product-image";
import { setProductImageAction } from "@/features/products/actions/set-product-image";
import { updateProductAction } from "@/features/products/actions/update-product";
import {
  ProductImageUpload,
  type ProductImageValue,
} from "@/features/products/components/product-image-upload";
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
  onUpdated,
}: {
  product: Product;
  tenantId: string;
  tenantSlug: string;
  onUpdated: (product: Product) => void;
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

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
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
