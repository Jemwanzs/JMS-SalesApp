"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { correctSaleAction } from "@/features/sales/actions/correct-sale";
import { ProductCombobox, type ProductComboboxItem } from "@/features/sales/components/product-combobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VoidOrCorrectResult } from "@/types/database.types";

export function CorrectSaleDialog({
  saleId,
  currentAmount,
  currentQuantity,
  currentProductId,
  currentSaleDate,
  todayDate,
  yesterdayDate,
  products,
  quantityEnabled,
  quantityMandatory,
  tenantSlug,
  onResolved,
}: {
  saleId: string;
  currentAmount: number;
  /** Seeds the field's initial value; whether it's shown/required now depends on the tenant's quantity settings and whichever product is currently selected (see showQuantity/quantityRequired below), since correcting into/out of a tracked product -- or a tenant that doesn't use quantity by control method at all -- changes that. */
  currentQuantity: number | null;
  currentProductId: string;
  /** The sale's own current business date -- seeds the date field and is what the "moving from X to Y" warning compares against. */
  currentSaleDate: string;
  /** The tenant/location's effective business date (same value threaded to SaleHistoryFilters elsewhere on this page) -- caps the date picker so a future date can never even be selected client-side; correct_sale() itself re-validates this server-side against the same centralized business-date logic, not a raw client "today". */
  todayDate: string;
  yesterdayDate: string;
  /** The tenant's real catalog, excluding the system "Others" product -- correcting a sale into free-text has no mechanism today. */
  products: ProductComboboxItem[];
  /** Settings -> Show Quantity. */
  quantityEnabled: boolean;
  /** Settings -> Inventory Configuration -> "Record Stock By" = Quantity, AND Inventory is entitled -- mirrors record-sale-dialog.tsx's own quantityMandatory exactly. A value-controlled tenant's tracked products still don't require one, so this must be checked alongside tracksInventory, not tracksInventory alone. */
  quantityMandatory: boolean;
  tenantSlug: string;
  onResolved: (result: VoidOrCorrectResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newAmount, setNewAmount] = useState(String(currentAmount));
  const [newQuantity, setNewQuantity] = useState(currentQuantity !== null ? String(currentQuantity) : "");
  const [newProductId, setNewProductId] = useState(currentProductId);
  const [newSaleDate, setNewSaleDate] = useState(currentSaleDate);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("SalesHistory");
  const tCommon = useTranslations("Common");
  const tSales = useTranslations("Sales");

  const selectedProduct = products.find((p) => p.id === newProductId);
  const showQuantity = quantityEnabled || quantityMandatory;
  const quantityRequired = quantityMandatory && (selectedProduct?.tracksInventory ?? false);

  function onProductChange(item: ProductComboboxItem) {
    setNewProductId(item.id);
    if (item.expectedPrice !== null) {
      setNewAmount(String(item.expectedPrice));
    }
    if (!item.tracksInventory) {
      setNewQuantity("");
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quantityRequired && (!newQuantity || Number(newQuantity) <= 0)) {
      setError(tCommon("checkEntries"));
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("saleId", saleId);
    formData.set("newAmount", newAmount);
    formData.set("newQuantity", newQuantity);
    formData.set("newNotes", reason);
    formData.set("newProductId", newProductId);
    formData.set("newSaleDate", newSaleDate);
    formData.set("reason", reason);

    startTransition(async () => {
      const result = await correctSaleAction(tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? tCommon("checkEntries"));
        return;
      }
      if (result.result) {
        setOpen(false);
        setReason("");
        onResolved(result.result);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t("correct")}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("correctThisSale")}</DialogTitle>
          <DialogDescription>
            {t("correctDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="correct-product">{t("product")}</Label>
            <ProductCombobox id="correct-product" items={products} value={newProductId} onChange={onProductChange} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="correct-amount">{t("correctedAmount")}</Label>
            <Input
              id="correct-amount"
              type="number"
              min="0"
              step="0.01"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              autoFocus
              required
            />
          </div>
          {showQuantity && (
            <div className="space-y-2">
              <Label htmlFor="correct-quantity">{tSales("quantity")}</Label>
              <Input
                id="correct-quantity"
                type="number"
                min="1"
                step="1"
                value={newQuantity}
                onChange={(e) => setNewQuantity(e.target.value)}
                required={quantityRequired}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>{t("saleDate")}</Label>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant={newSaleDate === todayDate ? "default" : "outline"}
                onClick={() => setNewSaleDate(todayDate)}
              >
                {t("today")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={newSaleDate === yesterdayDate ? "default" : "outline"}
                onClick={() => setNewSaleDate(yesterdayDate)}
              >
                {t("yesterday")}
              </Button>
              <Input
                type="date"
                value={newSaleDate}
                max={todayDate}
                onChange={(e) => setNewSaleDate(e.target.value)}
                className="h-8 w-auto"
                aria-label={t("saleDate")}
              />
            </div>
            {newSaleDate !== currentSaleDate && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("saleDateMoveWarning", { from: currentSaleDate, to: newSaleDate })}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="correct-reason">{tSales("reason")}</Label>
            <Input
              id="correct-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("submitting") : t("correctSale")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
