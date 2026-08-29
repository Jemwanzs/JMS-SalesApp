"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "tenant-branding";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];

export interface TenantLogoValue {
  url: string;
  storagePath: string;
}

/**
 * User & Tenant Branding Personalization. Direct-to-Storage upload,
 * closely mirroring features/products/components/product-image-upload.tsx's
 * proven flow (same namespaced-path convention, same upload-then-swap-
 * then-best-effort-delete-previous sequence, same "this component only
 * ever touches Storage, the caller's onChange decides what persisting
 * means" split), with two deliberate differences:
 *
 *   - Plain <img>, not next/image -- SVG is an explicitly supported
 *     format here, and Next's image optimizer refuses SVGs without
 *     extra dangerouslyAllowSVG config; a small fixed-size preview gets
 *     no real benefit from that machinery anyway.
 *   - A narrower `accept`/type allow-list (PNG/JPEG/SVG/WebP only, not
 *     the product form's broader `image/*`) so an unsupported format is
 *     rejected immediately with a clear message instead of only ever
 *     failing at the bucket's own server-side allowed_mime_types check
 *     (migration 0043).
 */
export function LogoUpload({
  tenantId,
  value,
  onChange,
}: {
  tenantId: string;
  value: TenantLogoValue | null;
  onChange: (value: TenantLogoValue | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Please choose a PNG, JPEG, SVG, or WebP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Logo must be 5MB or smaller");
      return;
    }

    setError(null);
    setIsUploading(true);

    const supabase = createClient();
    const storagePath = `${tenantId}/branding/${crypto.randomUUID()}-${file.name}`;

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
            // eslint-disable-next-line @next/next/no-img-element -- SVG support needs a plain <img>, see header comment
            <img src={value.url} alt="Business logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-lg">🏢</span>
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
            {isUploading ? "Uploading..." : value ? "Replace logo" : "Upload logo"}
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
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={onFileSelected}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
