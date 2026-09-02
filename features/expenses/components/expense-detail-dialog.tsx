"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { editExpenseAction } from "@/features/expenses/actions/edit-expense";
import { voidExpenseAction } from "@/features/expenses/actions/void-expense";
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
import type { ExpenseRecord } from "@/services/ExpenseService";

/**
 * Tap an existing expense row -- edit its amount/date/notes in place
 * (expenses.edit) or void it with a required reason (expenses.void).
 * Editing is a direct in-place update (edit_expense() RPC), deliberately
 * simpler than sales' full correction-request workflow -- expenses
 * carry far lower stakes than a sale, and the feature is explicitly
 * meant to stay lightweight (see migration 0054's header comment).
 */
export function ExpenseDetailDialog({
  tenantId,
  tenantSlug,
  timezone,
  todayDate,
  expense,
  canEdit,
  canVoid,
  onOpenChange,
}: {
  tenantId: string;
  tenantSlug: string;
  timezone: string;
  todayDate: string;
  expense: ExpenseRecord | null;
  canEdit: boolean;
  canVoid: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [actualAmount, setActualAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [notes, setNotes] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    setActualAmount(String(expense.actualAmount));
    setExpenseDate(expense.expenseDate);
    setNotes(expense.notes ?? "");
    setVoiding(false);
    setVoidReason("");
    setError(null);
  }, [expense]);

  function onSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    setError(null);

    const formData = new FormData();
    formData.set("expenseId", expense.id);
    formData.set("actualAmount", actualAmount);
    formData.set("expenseDate", expenseDate);
    formData.set("notes", notes);

    startTransition(async () => {
      const result = await editExpenseAction(tenantId, tenantSlug, timezone, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Expense updated");
      onOpenChange(false);
    });
  }

  function onConfirmVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    if (!voidReason.trim()) {
      setError("A reason is required");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("expenseId", expense.id);
    formData.set("reason", voidReason);

    startTransition(async () => {
      const result = await voidExpenseAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Expense voided");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={expense !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {expense && (
          <>
            <DialogHeader>
              <DialogTitle>{expense.expenseItemName}</DialogTitle>
              <DialogDescription>
                Recorded by {expense.recordedByName ?? "a team member"} on {expense.expenseDate}
              </DialogDescription>
            </DialogHeader>

            {!voiding ? (
              <form onSubmit={onSaveEdit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-actual-amount">Actual amount</Label>
                  <Input
                    id="edit-actual-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={actualAmount}
                    onChange={(e) => setActualAmount(e.target.value)}
                    disabled={!canEdit}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-date">Date</Label>
                  <Input
                    id="edit-date"
                    type="date"
                    max={todayDate}
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    disabled={!canEdit}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-notes">Notes (optional)</Label>
                  <Input id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} />
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                  {canEdit && (
                    <Button type="submit" disabled={isPending} className="w-full">
                      {isPending ? "Saving..." : "Save changes"}
                    </Button>
                  )}
                  {canVoid && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() => {
                        setVoiding(true);
                        setError(null);
                      }}
                    >
                      Void this expense
                    </Button>
                  )}
                </DialogFooter>
              </form>
            ) : (
              <form onSubmit={onConfirmVoid} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="void-reason">Reason for voiding</Label>
                  <Input
                    id="void-reason"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="What happened?"
                    autoFocus
                    required
                  />
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                  <Button type="submit" variant="destructive" disabled={isPending} className="w-full">
                    {isPending ? "Voiding..." : "Confirm void"}
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={() => setVoiding(false)}>
                    Cancel
                  </Button>
                </DialogFooter>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
