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
  stockControlMethod,
  movementType,
  onOpenChange,
}: {
  tenantId: string;
  tenantSlug: string;
  productId: string;
  productName: string;
  unitOfMeasure: string | null;
  /** Settings -> Inventory Configuration's tenant-wide choice -- decides whether this dialog asks for a unit count or a currency value. */
  stockControlMethod: "quantity" | "value";
  movementType: RecordableMovementType | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const byValue = stockControlMethod === "value";

  function reset() {
    setAmount("");
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
    formData.set(byValue ? "value" : "quantity", amount);
    formData.set(byValue ? "quantity" : "value", "");
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
                <Label htmlFor="stock-amount">{byValue ? "Value" : `Quantity${unitOfMeasure ? ` (${unitOfMeasure})` : ""}`}</Label>
                <Input
                  id="stock-amount"
                  type="number"
                  inputMode="decimal"
                  // HTML5 number-input validation requires (value - min) to
                  // be an exact multiple of step -- min and step must share
                  // the same base or an ordinary round value (e.g. 500 for
                  // a currency amount) gets rejected as "invalid" by the
                  // browser itself, found live: min="0.001" paired with a
                  // currency step of "0.01" failed on every whole number.
                  min={byValue ? "0.01" : "0.001"}
                  step={byValue ? "0.01" : "0.001"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
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
