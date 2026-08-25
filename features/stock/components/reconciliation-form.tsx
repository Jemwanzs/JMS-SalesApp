"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { submitReconciliationAction } from "@/features/stock/actions/submit-reconciliation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReconciliationPreview } from "@/services/StockService";

/**
 * Full-screen form, deliberately not a sheet/dialog like the quick-entry
 * flow -- this is a multi-field flow the user should be able to see
 * fully (opening/in/out/expected, actual count, and a reason once
 * there's a variance), not a quick tap-and-go action.
 */
export function ReconciliationForm({
  tenantId,
  tenantSlug,
  productId,
  productName,
  unitOfMeasure,
  date,
  preview,
}: {
  tenantId: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  unitOfMeasure: string | null;
  date: string;
  preview: ReconciliationPreview;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actualQuantity, setActualQuantity] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const variance = useMemo(() => {
    const actual = Number(actualQuantity);
    if (actualQuantity === "" || !Number.isFinite(actual)) return null;
    return actual - preview.expectedClosing;
  }, [actualQuantity, preview.expectedClosing]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (variance === null) {
      setError("Enter the actual physical count");
      return;
    }
    if (variance !== 0 && !varianceReason.trim()) {
      setError("A reason is required when there's a variance");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("date", date);
    formData.set("actualQuantity", actualQuantity);
    formData.set("varianceReason", varianceReason);

    startTransition(async () => {
      const result = await submitReconciliationAction(tenantId, tenantSlug, productId, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Reconciliation saved");
      router.push(`/t/${tenantSlug}/stock/reconcile`);
    });
  }

  const uom = unitOfMeasure ?? "units";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyStat label="Opening" value={preview.opening} unit={uom} />
        <ReadOnlyStat label="Stock in" value={preview.stockIn} unit={uom} />
        <ReadOnlyStat label="Stock out" value={preview.stockOut} unit={uom} />
        <ReadOnlyStat label="Expected closing" value={preview.expectedClosing} unit={uom} emphasize />
      </div>

      <div className="space-y-2">
        <Label htmlFor="actual-quantity">Actual physical count ({uom})</Label>
        <Input
          id="actual-quantity"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.001"
          value={actualQuantity}
          onChange={(e) => setActualQuantity(e.target.value)}
          autoFocus
          required
        />
      </div>

      {variance !== null && (
        <div className={`rounded-lg border p-3 text-center ${variance === 0 ? "" : "border-destructive"}`}>
          <p className="text-xs text-muted-foreground">Variance</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${variance === 0 ? "" : "text-destructive"}`}>
            {variance > 0 ? "+" : ""}
            {variance} {uom}
          </p>
        </div>
      )}

      {variance !== null && variance !== 0 && (
        <div className="space-y-2">
          <Label htmlFor="variance-reason">Reason for variance</Label>
          <Input
            id="variance-reason"
            value={varianceReason}
            onChange={(e) => setVarianceReason(e.target.value)}
            placeholder="What explains the difference?"
            required
          />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Saving..." : `Complete reconciliation for ${productName}`}
      </Button>
    </form>
  );
}

function ReadOnlyStat({ label, value, unit, emphasize }: { label: string; value: number; unit: string; emphasize?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums ${emphasize ? "text-lg font-semibold" : "text-sm font-medium"}`}>
        {value} {unit}
      </p>
    </div>
  );
}
