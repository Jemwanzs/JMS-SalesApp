"use client";

import { useState, useTransition } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { createProductAction } from "@/features/products/actions/create-product";
import {
  ProductImageUpload,
  type ProductImageValue,
} from "@/features/products/components/product-image-upload";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Product } from "@/services/ProductService";
import { createProductSchema, type CreateProductInput } from "@/validations/product";

export function AddProductForm({
  tenantId,
  tenantSlug,
  onCreated,
}: {
  tenantId: string;
  tenantSlug: string;
  onCreated?: (product: Product) => void;
}) {
  const [isPending, startTransition] = useTransition();
  // Pre-generated so an image can be uploaded to its final Storage path
  // (tenant_id/products/{productId}/...) before the product row exists --
  // see product-image-upload.tsx and ProductService.create's optional `id`.
  const [productId, setProductId] = useState(() => crypto.randomUUID());
  const [image, setImage] = useState<ProductImageValue | null>(null);
  const [showNameInPhotoView, setShowNameInPhotoView] = useState(true);

  const form = useForm<CreateProductInput>({
    resolver: zodResolver(createProductSchema),
    defaultValues: { name: "", expectedPrice: "0", imageUrl: "" },
  });

  function onSubmit(values: CreateProductInput) {
    const formData = new FormData();
    formData.set("id", productId);
    formData.set("name", values.name);
    formData.set("expectedPrice", values.expectedPrice);
    formData.set("imageUrl", image?.url ?? "");
    formData.set("imageStoragePath", image?.storagePath ?? "");
    formData.set("showNameInPhotoView", String(showNameInPhotoView));

    startTransition(async () => {
      const result = await createProductAction(tenantId, tenantSlug, {}, formData);

      if (result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          form.setError(field as keyof CreateProductInput, { message });
        }
        return;
      }

      if (result.success) {
        if (result.product) {
          onCreated?.(result.product);
        }
        form.reset({ name: "", expectedPrice: "0", imageUrl: "" });
        setImage(null);
        setProductId(crypto.randomUUID());
        setShowNameInPhotoView(true);
      }
    });
  }

  return (
    <Form {...form}>
      <form data-tour-id="add-product-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <ProductImageUpload
          tenantId={tenantId}
          productId={productId}
          value={image}
          onChange={setImage}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Product name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Coffee" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="expectedPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expected price</FormLabel>
                <FormControl>
                  <Input type="number" min="0" step="0.01" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="add-show-name-in-photo" className="font-normal">
            Show product name when photo is viewed enlarged
          </Label>
          <Switch
            id="add-show-name-in-photo"
            checked={showNameInPhotoView}
            onCheckedChange={setShowNameInPhotoView}
          />
        </div>
        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Adding..." : "Add product"}
        </Button>
      </form>
    </Form>
  );
}
