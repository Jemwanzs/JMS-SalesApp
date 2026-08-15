"use client";

import { useState, useTransition } from "react";

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
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
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
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Correct</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct this sale</DialogTitle>
          <DialogDescription>
            The original is kept and marked corrected; a new sale is recorded with the fixed
            amount, linked back to this one.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="correct-amount">Corrected amount</Label>
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
            <Label htmlFor="correct-reason">Reason</Label>
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
              {isPending ? "Submitting..." : "Correct sale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
