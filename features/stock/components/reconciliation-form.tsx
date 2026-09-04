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
  stockControlMethod,
  date,
  preview,
  actualRecordedSales,
}: {
  tenantId: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  unitOfMeasure: string | null;
  stockControlMethod: "quantity" | "value";
  date: string;
  preview: ReconciliationPreview;
  /** Value-based control only -- today's real revenue for this product, pre-fetched. */
  actualRecordedSales?: number;
}) {
  if (stockControlMethod === "value") {
    return (
      <ValueReconciliationForm
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        productId={productId}
        productName={productName}
        date={date}
        preview={preview}
        actualRecordedSales={actualRecordedSales ?? 0}
      />
    );
  }

  return (
    <QuantityReconciliationForm
      tenantId={tenantId}
      tenantSlug={tenantSlug}
      productId={productId}
      productName={productName}
      unitOfMeasure={unitOfMeasure}
      date={date}
      preview={preview}
    />
  );
}

function QuantityReconciliationForm({
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

/**
 * Value-based control: no physical unit count. Expected Sales Value
 * (opening + added, both already priced via each movement's own
 * snapshot -- see migration 0067) is compared against real recorded
 * revenue plus an estimated remaining-stock value the reconciler enters,
 * plus any already-recorded valid adjustments (damage/spoilage/etc,
 * entered here as a single rolled-up figure for the day). Only what's
 * left over becomes the unexplained variance -- never assumed to be
 * theft/loss outright, per the user's own explicit instruction.
 */
function ValueReconciliationForm({
  tenantId,
  tenantSlug,
  productId,
  productName,
  date,
  preview,
  actualRecordedSales,
}: {
  tenantId: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  date: string;
  preview: ReconciliationPreview;
  actualRecordedSales: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actualRemainingValue, setActualRemainingValue] = useState("");
  const [validAdjustmentsValue, setValidAdjustmentsValue] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const expectedSalesValue = preview.expectedSalesValue;

  const unexplainedVariance = useMemo(() => {
    const remaining = Number(actualRemainingValue);
    const adjustments = Number(validAdjustmentsValue) || 0;
    if (actualRemainingValue === "" || !Number.isFinite(remaining)) return null;
    return expectedSalesValue - actualRecordedSales - remaining - adjustments;
  }, [actualRemainingValue, validAdjustmentsValue, expectedSalesValue, actualRecordedSales]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (unexplainedVariance === null) {
      setError("Enter the estimated remaining stock value");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("date", date);
    formData.set("actualRecordedSales", String(actualRecordedSales));
    formData.set("actualRemainingValue", actualRemainingValue);
    formData.set("validAdjustmentsValue", validAdjustmentsValue || "0");
    if (unexplainedVariance !== 0) {
      formData.set("varianceReason", "See value-based reconciliation figures");
    }

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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyStat label="Opening value" value={preview.openingValue} unit="" decimals />
        <ReadOnlyStat label="Added value" value={preview.addedValue} unit="" decimals />
        <ReadOnlyStat label="Expected sales value" value={expectedSalesValue} unit="" emphasize decimals />
        <ReadOnlyStat label="Actual recorded sales" value={actualRecordedSales} unit="" decimals />
      </div>

      <div className="space-y-2">
        <Label htmlFor="actual-remaining-value">Actual remaining stock value (estimate)</Label>
        <Input
          id="actual-remaining-value"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={actualRemainingValue}
          onChange={(e) => setActualRemainingValue(e.target.value)}
          autoFocus
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="valid-adjustments-value">Valid adjustments (discounts, damage, complimentary, etc.)</Label>
        <Input
          id="valid-adjustments-value"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={validAdjustmentsValue}
          onChange={(e) => setValidAdjustmentsValue(e.target.value)}
        />
      </div>

      {unexplainedVariance !== null && (
        <div className={`rounded-lg border p-3 text-center ${unexplainedVariance === 0 ? "" : "border-destructive"}`}>
          <p className="text-xs text-muted-foreground">Unexplained variance</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${unexplainedVariance === 0 ? "" : "text-destructive"}`}>
            {unexplainedVariance > 0 ? "+" : ""}
            {unexplainedVariance.toFixed(2)}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Saving..." : `Complete reconciliation for ${productName}`}
      </Button>
    </form>
  );
}

function ReadOnlyStat({
  label,
  value,
  unit,
  emphasize,
  decimals,
}: {
  label: string;
  value: number;
  unit: string;
  emphasize?: boolean;
  decimals?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 tabular-nums ${emphasize ? "text-lg font-semibold" : "text-sm font-medium"}`}>
        {decimals ? value.toFixed(2) : value} {unit}
      </p>
    </div>
  );
}
