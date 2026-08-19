"use client";

import { useState, useTransition } from "react";

import { reverseSaleAction } from "@/features/sales/actions/reverse-sale";
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

/**
 * REVERSE (docs/08-sales-engine.md): an offsetting entry, not a delete.
 * The original sale stays fully visible (status flips to "reversed");
 * a new sale row is recorded with the negated amount, so both remain in
 * history and net to zero in every gross-sales total -- unlike Void,
 * which removes the sale from totals with no replacement.
 */
export function ReverseSaleDialog({
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("saleId", saleId);
    formData.set("reason", reason);

    startTransition(async () => {
      const result = await reverseSaleAction(tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entry");
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
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Reverse</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse this sale</DialogTitle>
          <DialogDescription>
            The sale stays on record. A new offsetting entry for the same amount will be recorded alongside it,
            netting to zero in your totals. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reverse-reason">Reason</Label>
            <Input
              id="reverse-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Reversing..." : "Reverse sale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
