"use client";

import { useRef, useState } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;

export interface ProductImageValue {
  url: string;
  storagePath: string;
}

/**
 * Direct-to-Storage upload (docs/10-products.md: bucket `product-images`,
 * path `tenant_id/products/{productId}/{filename}`) -- this component
 * only ever touches Storage, never the `products`/`product_images`
 * tables. The caller's onChange decides what "changed" means for its
 * own flow: the edit dialog persists immediately (the product already
 * exists), the create form just holds the value in local state until
 * the product itself is created (see add-product-form.tsx).
 *
 * Replacing/removing best-effort deletes the PREVIOUS value's storage
 * object (via the `value` prop this component already has, not a DB
 * lookup) so an in-progress create flow never orphans an earlier
 * upload attempt. For the edit flow this is redundant with
 * ProductService.setImage/removeImage's own DB-driven cleanup -- both
 * are safe to run; removing an already-removed object is a no-op.
 */
export function ProductImageUpload({
  tenantId,
  productId,
  value,
  onChange,
}: {
  tenantId: string;
  productId: string;
  value: ProductImageValue | null;
  onChange: (value: ProductImageValue | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be 5MB or smaller");
      return;
    }

    setError(null);
    setIsUploading(true);

    const supabase = createClient();
    const storagePath = `${tenantId}/products/${productId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file);

    if (uploadError) {
      setError(uploadError.message);
      setIsUploading(false);
      return;
    }

    const previousPath = value?.storagePath;
    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    onChange({ url: publicUrlData.publicUrl, storagePath });
    setIsUploading(false);

    if (previousPath) {
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }
  }

  function onRemoveClick() {
    const previousPath = value?.storagePath;
    onChange(null);
    if (previousPath) {
      createClient().storage.from(BUCKET).remove([previousPath]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {value ? (
            <Image
              src={value.url}
              alt="Product"
              width={56}
              height={56}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <span className="text-lg">🛒</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
          >
            {isUploading ? "Uploading..." : value ? "Replace photo" : "Add photo"}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemoveClick}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onFileSelected}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
