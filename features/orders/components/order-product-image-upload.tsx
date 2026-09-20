"use client";

import { useRef, useState } from "react";
import Image from "next/image";

import { setOrderProductImageAction } from "@/features/orders/actions/set-order-product-image";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "order-product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Direct-to-Storage upload against the new order-product-images bucket,
 * mirroring logo-upload.tsx's exact upload-then-swap-then-best-effort-
 * delete-previous sequence. Only shown in Edit mode (needs a real
 * orderProductId already) -- Add mode saves the text fields first, same
 * "create the row, then attach an image" split RecordExpenseInput's own
 * client-generated-id workaround was built to avoid needing here.
 */
export function OrderProductImageUpload({
  tenantId,
  tenantSlug,
  orderProductId,
  imageUrl,
  imageStoragePath,
}: {
  tenantId: string;
  tenantSlug: string;
  orderProductId: string;
  imageUrl: string | null;
  imageStoragePath: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(imageUrl);
  const [storagePath, setStoragePath] = useState(imageStoragePath);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Please choose a JPEG, PNG, WebP, or GIF image");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be 5MB or smaller");
      return;
    }

    setError(null);
    setIsUploading(true);

    const supabase = createClient();
    const newPath = `${tenantId}/order-products/${orderProductId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(newPath, file);
    if (uploadError) {
      setError(uploadError.message);
      setIsUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(newPath);
    const result = await setOrderProductImageAction(tenantId, tenantSlug, orderProductId, newPath, publicUrlData.publicUrl);

    if (result.error) {
      setError(result.error);
      await supabase.storage.from(BUCKET).remove([newPath]);
      setIsUploading(false);
      return;
    }

    const previousPath = storagePath;
    setUrl(publicUrlData.publicUrl);
    setStoragePath(newPath);
    setIsUploading(false);

    if (previousPath) {
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }
  }

  async function onRemoveClick() {
    const previousPath = storagePath;
    setUrl(null);
    setStoragePath(null);
    await setOrderProductImageAction(tenantId, tenantSlug, orderProductId, null, null);
    if (previousPath) {
      await createClient().storage.from(BUCKET).remove([previousPath]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {url ? (
            <Image src={url} alt="" fill className="object-cover" />
          ) : (
            <span className="text-lg">📦</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => inputRef.current?.click()}>
            {isUploading ? "Uploading..." : url ? "Replace photo" : "Upload photo"}
          </Button>
          {url && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemoveClick}>
              Remove
            </Button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={onFileSelected} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
