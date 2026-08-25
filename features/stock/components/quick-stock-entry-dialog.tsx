"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { recordMovementAction } from "@/features/stock/actions/record-movement";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RecordableMovementType } from "@/services/StockService";

const REASON_REQUIRED: ReadonlySet<RecordableMovementType> = new Set([
  "adjustment_increase",
  "adjustment_decrease",
  "damaged",
  "expired",
  "lost",
]);

const TITLES: Record<RecordableMovementType, string> = {
  opening_stock: "Set opening stock",
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment_increase: "Adjust stock up",
  adjustment_decrease: "Adjust stock down",
  damaged: "Mark damaged",
  expired: "Mark expired",
  lost: "Mark lost/missing",
};

/**
 * One shared dialog for every quick stock action (Product Enhancements
 * #4) -- same "tap an item, get a focused entry form" idiom as
 * RecordSaleDialog for Sales, rather than a bottom sheet, so stock entry
 * reads as part of the same app instead of a different interaction
 * pattern bolted on. `movementType` (null = closed) decides the title
 * and whether the reason field is shown/required, matching the DB check
 * constraint exactly so nothing surprises the user at submit time.
 */
export function QuickStockEntryDialog({
  tenantId,
  tenantSlug,
  productId,
  productName,
  unitOfMeasure,
  movementType,
  onOpenChange,
}: {
  tenantId: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  unitOfMeasure: string | null;
  movementType: RecordableMovementType | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setQuantity("");
    setReason("");
    setError(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!movementType) return;

    const reasonRequired = REASON_REQUIRED.has(movementType);
    if (reasonRequired && !reason.trim()) {
      setError("A reason is required");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("movementType", movementType);
    formData.set("quantity", quantity);
    formData.set("reason", reason);

    startTransition(async () => {
      const result = await recordMovementAction(tenantId, tenantSlug, productId, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Recorded");
      reset();
      onOpenChange(false);
    });
  }

  const reasonRequired = movementType ? REASON_REQUIRED.has(movementType) : false;

  return (
    <Dialog
      open={movementType !== null}
      onOpenChange={(open) => {
        if (!open) reset();
        onOpenChange(open);
      }}
    >
      <DialogContent>
        {movementType && (
          <>
            <DialogHeader>
              <DialogTitle>{TITLES[movementType]}</DialogTitle>
              <DialogDescription>{productName}</DialogDescription>
            </DialogHeader>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="stock-quantity">Quantity{unitOfMeasure ? ` (${unitOfMeasure})` : ""}</Label>
                <Input
                  id="stock-quantity"
                  type="number"
                  inputMode="decimal"
                  min="0.001"
                  step="0.001"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              {reasonRequired && (
                <div className="space-y-2">
                  <Label htmlFor="stock-reason">Reason</Label>
                  <Input
                    id="stock-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="What happened?"
                    required
                  />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter>
                <Button type="submit" disabled={isPending} className="w-full">
                  {isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
