"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { recordExpenseAction } from "@/features/expenses/actions/record-expense";
import { ExpenseItemCombobox } from "@/features/expenses/components/expense-item-combobox";
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
import type { ExpenseItem } from "@/services/ExpenseItemService";

/**
 * "+ Add Expense" -- select a configured Expense Item, see its
 * estimated amount as plain reference text (never a constraint on the
 * Actual Amount field, per spec), enter the real amount, and a date
 * that defaults to today and can only move backward (`max` = today,
 * re-checked server-side too). Same "tap an item, get a focused form"
 * idiom RecordSaleDialog/QuickStockEntryDialog already use.
 */
export function RecordExpenseDialog({
  tenantId,
  tenantSlug,
  timezone,
  todayDate,
  open,
  onOpenChange,
  activeItems,
}: {
  tenantId: string;
  tenantSlug: string;
  timezone: string;
  todayDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeItems: ExpenseItem[];
}) {
  const [isPending, startTransition] = useTransition();
  // Starts unset (no item pre-selected) -- the searchable combobox
  // requires an explicit tap-to-select, so silently defaulting to the
  // first item would make it easy to record an expense against the
  // wrong one without noticing.
  const [expenseItemId, setExpenseItemId] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayDate);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setExpenseItemId("");
    setActualAmount("");
    setExpenseDate(todayDate);
    setNotes("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedItem = activeItems.find((i) => i.id === expenseItemId) ?? null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!expenseItemId) {
      setError("Select an expense item");
      return;
    }

    const formData = new FormData();
    formData.set("expenseItemId", expenseItemId);
    formData.set("actualAmount", actualAmount);
    formData.set("expenseDate", expenseDate);
    formData.set("notes", notes);

    startTransition(async () => {
      const result = await recordExpenseAction(tenantId, tenantSlug, timezone, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Expense recorded");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          {activeItems.length === 0 && (
            <DialogDescription>No expense items configured yet -- add one under More &rarr; Expense Items first.</DialogDescription>
          )}
        </DialogHeader>

        {activeItems.length > 0 && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="expense-item">Expense item</Label>
              <ExpenseItemCombobox id="expense-item" items={activeItems} value={expenseItemId} onChange={setExpenseItemId} />
              {selectedItem?.estimatedAmount != null && (
                <p className="text-xs text-muted-foreground">Estimated: {selectedItem.estimatedAmount.toFixed(2)} (a guide only)</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-actual-amount">Actual amount</Label>
              <Input
                id="expense-actual-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={actualAmount}
                onChange={(e) => setActualAmount(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                max={todayDate}
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-notes">Notes (optional)</Label>
              <Input id="expense-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? "Recording..." : "Record expense"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
