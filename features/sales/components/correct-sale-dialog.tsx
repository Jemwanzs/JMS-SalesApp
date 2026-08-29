"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { correctSaleAction } from "@/features/sales/actions/correct-sale";
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
  tenantSlug,
  onResolved,
}: {
  saleId: string;
  currentAmount: number;
  tenantSlug: string;
  onResolved: (result: VoidOrCorrectResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newAmount, setNewAmount] = useState(String(currentAmount));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("SalesHistory");
  const tCommon = useTranslations("Common");
  const tSales = useTranslations("Sales");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("saleId", saleId);
    formData.set("newAmount", newAmount);
    formData.set("newQuantity", "");
    formData.set("newNotes", "");
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
