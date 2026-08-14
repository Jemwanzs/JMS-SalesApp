"use client";

import { useEffect, useState, useTransition } from "react";

import { recordSaleAction, type RecordSaleState } from "@/features/sales/actions/record-sale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Product } from "@/services/ProductService";

export function RecordSaleSheet({
  product,
  tenantId,
  tenantSlug,
  locationId,
  businessDayId,
  onOpenChange,
  onRecorded,
}: {
  product: Product | null;
  tenantId: string;
  tenantSlug: string;
  locationId: string;
  businessDayId: string;
  onOpenChange: (open: boolean) => void;
  onRecorded: (sale: NonNullable<RecordSaleState["sale"]>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Generated once per product selection (not per submit attempt) so a
  // double-tap, timeout retry, or refresh all carry the same key -- see
  // docs/08-sales-engine.md.
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (product) {
      setAmount(product.expectedPrice ? String(product.expectedPrice) : "");
      setQuantity("1");
      setNotes("");
      setError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [product]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    setError(null);

    const formData = new FormData();
    formData.set("productId", product.id);
    formData.set("actualAmount", amount);
    formData.set("quantity", quantity);
    formData.set("notes", notes);
    formData.set("idempotencyKey", idempotencyKey);

    startTransition(async () => {
      const result = await recordSaleAction(
        tenantId,
        tenantSlug,
        locationId,
        businessDayId,
        {},
        formData
      );

      if (result.error) {
        setError(result.error);
        return;
      }

      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
        return;
      }

      if (result.sale) {
        onRecorded(result.sale);
      }
    });
  }

  return (
    <Sheet open={product !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        {product && (
          <>
            <SheetHeader>
              <SheetTitle>{product.name}</SheetTitle>
              {product.expectedPrice !== null && product.showExpectedPrice && (
                <SheetDescription>
                  Expected price: {product.expectedPrice.toFixed(2)}
                </SheetDescription>
              )}
            </SheetHeader>

            <form onSubmit={onSubmit} className="space-y-4 px-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount sold</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes (optional)</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <SheetFooter className="p-0">
                <Button type="submit" disabled={isPending} className="w-full">
                  {isPending ? "Recording..." : "Record Sale"}
                </Button>
              </SheetFooter>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
