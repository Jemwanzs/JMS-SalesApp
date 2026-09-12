"use client";

import { useRef, useState } from "react";
import { FileText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BUCKET = "expense-receipts";
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export interface ExpenseReceiptValue {
  storagePath: string;
  fileType: string;
}

/**
 * Direct-to-Storage upload against the PRIVATE `expense-receipts` bucket
 * (migration 0083) -- modeled on ProductImageUpload, but unlike that
 * component's public bucket, no public URL exists here at all. A local
 * `URL.createObjectURL` preview covers the moment right after picking a
 * file (before the expense row exists to ask a signed-URL action for),
 * and a signed URL is fetched on demand later, from ReceiptViewer, once
 * the expense is saved -- see that component and view-expense-receipt.ts.
 *
 * `expenseId` is the CLIENT-generated id the caller already created
 * before this component mounts (ExpenseService.RecordExpenseInput.id) --
 * the path targets `{tenantId}/expenses/{expenseId}/...` before the row
 * itself exists, same trick ProductImageUpload doesn't need (a product
 * is always created first, its image added after).
 */
export function ReceiptUpload({
  tenantId,
  expenseId,
  value,
  onChange,
}: {
  tenantId: string;
  expenseId: string;
  value: ExpenseReceiptValue | null;
  onChange: (value: ExpenseReceiptValue | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Please choose a JPEG, PNG, WebP, or PDF file");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File must be 5MB or smaller");
      return;
    }

    setError(null);
    setIsUploading(true);

    const supabase = createClient();
    const storagePath = `${tenantId}/expenses/${expenseId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file);

    if (uploadError) {
      setError(uploadError.message);
      setIsUploading(false);
      return;
    }

    const previousPath = value?.storagePath;
    if (file.type.startsWith("image/")) {
      setLocalPreviewUrl(URL.createObjectURL(file));
    } else {
      setLocalPreviewUrl(null);
    }

    onChange({ storagePath, fileType: file.type });
    setIsUploading(false);

    if (previousPath) {
      await supabase.storage.from(BUCKET).remove([previousPath]);
    }
  }

  function onRemoveClick() {
    const previousPath = value?.storagePath;
    onChange(null);
    setLocalPreviewUrl(null);
    if (previousPath) {
      createClient().storage.from(BUCKET).remove([previousPath]);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {value && localPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a receipt can be a PDF too, and this is a short-lived local blob: URL, not a remote asset next/image can optimize.
            <img src={localPreviewUrl} alt="Receipt" className="h-full w-full object-cover" />
          ) : value ? (
            <FileText className="h-6 w-6 text-muted-foreground" />
          ) : (
            <span className="text-lg">🧾</span>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={isUploading} onClick={() => inputRef.current?.click()}>
            {isUploading ? "Uploading..." : value ? "Replace receipt" : "Attach receipt"}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemoveClick}>
              <X className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={onFileSelected} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
