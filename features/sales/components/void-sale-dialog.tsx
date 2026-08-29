"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { voidSaleAction } from "@/features/sales/actions/void-sale";
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

export function VoidSaleDialog({
  saleId,
  tenantSlug,
  onResolved,
}: {
  saleId: string;
  tenantSlug: string;
  onResolved: (result: VoidOrCorrectResult) => void;
}) {
  const [open, setOpen] = useState(false);
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
    formData.set("reason", reason);

    startTransition(async () => {
      const result = await voidSaleAction(tenantSlug, {}, formData);

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
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t("void")}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("voidThisSale")}</DialogTitle>
          <DialogDescription>
            {t("voidDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="void-reason">{tSales("reason")}</Label>
            <Input
              id="void-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? t("voiding") : t("voidSale")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
