"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, X } from "lucide-react";

import { downloadExpenseReceiptAction } from "@/features/expenses/actions/download-expense-receipt";
import { viewExpenseReceiptAction } from "@/features/expenses/actions/view-expense-receipt";
import { Button } from "@/components/ui/button";

/**
 * Tap-to-preview a receipt. Image types get the TenantLogoViewer
 * portal/fixed-position pattern (bypassing components/ui/dialog.tsx for
 * the same scroll-position centering bug that component's own header
 * comment documents). PDFs just open a fresh signed URL in a new tab --
 * no embedded PDF renderer in Phase 1. Each tap fetches a FRESH signed
 * URL (receipts are in a private bucket, migration 0083) rather than
 * caching one, since the preview link expires after 5 minutes.
 */
export function ReceiptViewer({
  tenantId,
  storagePath,
  fileType,
  canView,
  canDownload,
}: {
  tenantId: string;
  storagePath: string;
  fileType: string | null;
  canView: boolean;
  canDownload: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isImage = fileType?.startsWith("image/") ?? false;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function onOpenPreview() {
    setError(null);
    setIsLoading(true);
    const result = await viewExpenseReceiptAction(tenantId, storagePath);
    setIsLoading(false);
    if (result.error || !result.url) {
      setError(result.error ?? "Could not open this receipt");
      return;
    }
    if (isImage) {
      setPreviewUrl(result.url);
      setOpen(true);
    } else {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  }

  async function onDownload() {
    setError(null);
    setIsLoading(true);
    const result = await downloadExpenseReceiptAction(tenantId, storagePath);
    setIsLoading(false);
    if (result.error || !result.url) {
      setError(result.error ?? "Could not download this receipt");
      return;
    }
    window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {canView && (
          <Button type="button" variant="outline" size="sm" disabled={isLoading} onClick={onOpenPreview}>
            <FileText className="h-3.5 w-3.5" />
            {isImage ? "View receipt" : "Open receipt"}
          </Button>
        )}
        {canDownload && (
          <Button type="button" variant="ghost" size="sm" disabled={isLoading} onClick={onDownload}>
            Download
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {open &&
        previewUrl &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Receipt"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
            onClick={() => setOpen(false)}
          >
            <div
              className="relative flex max-h-[85vh] w-full max-w-sm items-center justify-center overflow-hidden rounded-xl bg-popover p-6 ring-1 ring-foreground/10"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not something next/image should cache/optimize */}
              <img src={previewUrl} alt="Receipt" className="max-h-[70vh] max-w-full object-contain" />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
