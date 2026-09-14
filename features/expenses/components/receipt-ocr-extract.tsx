"use client";

import { useState } from "react";

import { extractReceiptDataAction, type ExtractedReceiptData } from "@/features/expenses/actions/extract-receipt-data";
import { Button } from "@/components/ui/button";
import type { ExpenseReceiptValue } from "@/features/expenses/components/receipt-upload";

function formatField(label: string, value: string | number | null): string {
  return `${label}: ${value === null ? "not read" : value}`;
}

/**
 * "Extract details from receipt" -- only shown for an image receipt
 * (extractReceiptDataAction itself refuses PDFs) while OCR is both
 * platform-configured and tenant-enabled. Always a two-step suggest ->
 * review -> apply flow, never auto-fills the form on its own: the
 * extracted values sit here until the user explicitly taps "Use these
 * values," matching this feature's whole "OCR suggests, a human still
 * decides" design.
 */
export function ReceiptOcrExtract({
  tenantId,
  receipt,
  ocrEnabled,
  ocrConfigured,
  canViewReceipt,
  onApply,
}: {
  tenantId: string;
  receipt: ExpenseReceiptValue | null;
  ocrEnabled: boolean;
  ocrConfigured: boolean;
  canViewReceipt: boolean;
  onApply: (data: ExtractedReceiptData) => void;
}) {
  const [isExtracting, setIsExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedReceiptData | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!receipt || !ocrEnabled || !ocrConfigured || !canViewReceipt) {
    return null;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(receipt.fileType)) {
    return null;
  }

  async function onExtract() {
    setIsExtracting(true);
    setError(null);
    setExtracted(null);
    const result = await extractReceiptDataAction(tenantId, receipt!.storagePath, receipt!.fileType);
    setIsExtracting(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setExtracted(result.data ?? null);
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" disabled={isExtracting} onClick={onExtract}>
        {isExtracting ? "Reading receipt..." : "Extract details from receipt"}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {extracted && (
        <div className="space-y-1.5 rounded-lg border p-3 text-xs">
          <p className="font-medium text-foreground">We read from the receipt:</p>
          <p className="text-muted-foreground">{formatField("Vendor", extracted.vendor)}</p>
          <p className="text-muted-foreground">{formatField("Date", extracted.date)}</p>
          <p className="text-muted-foreground">{formatField("Amount", extracted.amount)}</p>
          <p className="text-muted-foreground">{formatField("Tax", extracted.taxAmount)}</p>
          <p className="text-muted-foreground">{formatField("Reference", extracted.referenceNumber)}</p>
          <Button
            type="button"
            size="sm"
            className="mt-1 w-full"
            onClick={() => {
              onApply(extracted);
              setExtracted(null);
            }}
          >
            Use these values
          </Button>
        </div>
      )}
    </div>
  );
}
