"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { recordSaleAction, type RecordSaleState } from "@/features/sales/actions/record-sale";
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
import type { Product } from "@/services/ProductService";

export function RecordSaleDialog({
  product,
  tenantId,
  tenantSlug,
  locationId,
  businessDayId,
  quantityEnabled,
  notesEnabled,
  onOpenChange,
  onRecorded,
}: {
  product: Product | null;
  tenantId: string;
  tenantSlug: string;
  locationId: string;
  businessDayId: string;
  quantityEnabled: boolean;
  notesEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: (sale: NonNullable<RecordSaleState["sale"]>) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("Sales");
  const tCommon = useTranslations("Common");
  const [amount, setAmount] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [manualProductName, setManualProductName] = useState("");
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
      setManualProductName("");
      setError(null);
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [product]);

  // The tenant's own Settings -> Quantity field toggle is the sole
  // authority here, for every product regardless of tracks_inventory or
  // stock_control_method -- a tenant who has decided they don't want to
  // ask staff for a quantity meant that, full stop, not "except for
  // tracked products." An earlier version of this let a tracked
  // product's own configuration override the toggle in both directions
  // (forcing it visible+required for a quantity-controlled product,
  // forcing it hidden for a value-controlled one) -- reverted after
  // live feedback: that's the toggle's decision to make, not a per-
  // product one. Stock deduction (migration 0071) no longer depends on
  // an explicit quantity either way -- it infers one from the sale
  // amount and the product's own selling price whenever none is given,
  // for any tracked product, regardless of control method.
  const showQuantity = quantityEnabled;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    if (product.isSystem && !manualProductName.trim()) {
      setError(t("enterProductNameError"));
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("productId", product.id);
    formData.set("actualAmount", amount);
    formData.set("manualProductName", product.isSystem ? manualProductName.trim() : "");
    // Quantity is always sent, forced to "" when the field is hidden --
    // recordSaleSchema already treats "" as "not provided" (validations/
    // sale.ts), but FormData.get() on a key that was never set() returns
    // null, which fails that schema on both branches. Omitting the key
    // entirely (rather than sending "") would break every submission
    // while quantityEnabled is false.
    formData.set("quantity", showQuantity ? quantity : "");
    formData.set("notes", notesEnabled ? notes : "");
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
        setError(Object.values(result.fieldErrors)[0] ?? tCommon("checkEntries"));
        return;
      }

      if (result.sale) {
        onRecorded(result.sale);
      }
    });
  }

  return (
    <Dialog open={product !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {product && (
          <>
            <DialogHeader>
              <DialogTitle>{product.name}</DialogTitle>
              {product.expectedPrice !== null && product.showExpectedPrice && (
                <DialogDescription>
                  {t("expectedPrice", { price: product.expectedPrice.toFixed(2) })}
                </DialogDescription>
              )}
            </DialogHeader>

            <form onSubmit={onSubmit} className="space-y-4">
              {product.isSystem && (
                <div className="space-y-2">
                  <Label htmlFor="manualProductName">{t("enterProductName")}</Label>
                  <Input
                    id="manualProductName"
                    value={manualProductName}
                    onChange={(e) => setManualProductName(e.target.value)}
                    placeholder={t("whatDidCustomerBuy")}
                    autoFocus
                    required
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="amount">{t("amountSold")}</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus={!product.isSystem}
                  required
                />
              </div>

              {showQuantity && (
                <div className="space-y-2">
                  <Label htmlFor="quantity">{t("quantity")}</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    step="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
              )}

              {notesEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="notes">{t("notesOptional")}</Label>
                  <Input
                    id="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <DialogFooter>
                <Button
                  type="submit"
                  disabled={isPending || (product.isSystem && !manualProductName.trim())}
                  className="w-full"
                >
                  {isPending ? t("recording") : t("recordSale")}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
