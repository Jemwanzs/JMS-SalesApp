"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { createExpenseItemAction } from "@/features/expenses/actions/create-expense-item";
import { updateExpenseItemAction } from "@/features/expenses/actions/update-expense-item";
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
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { ExpenseItem, ExpenseItemType } from "@/services/ExpenseItemService";

/**
 * One dialog for both Add and Edit -- `editingItem` (null = Add mode)
 * drives the title and which server action fires, same "one dialog,
 * mode driven by which record is selected" idiom QuickStockEntryDialog
 * already uses for Stock.
 */
export function ExpenseItemFormDialog({
  tenantId,
  tenantSlug,
  open,
  onOpenChange,
  editingItem,
  categories,
}: {
  tenantId: string;
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingItem: ExpenseItem | null;
  categories: ExpenseCategory[];
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [expenseType, setExpenseType] = useState<ExpenseItemType>("recurring");
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingItem?.name ?? "");
    setExpenseType(editingItem?.expenseType ?? "recurring");
    setEstimatedAmount(editingItem?.estimatedAmount != null ? String(editingItem.estimatedAmount) : "");
    setCategoryId(editingItem?.categoryId ?? "");
    setError(null);
  }, [open, editingItem]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("expenseType", expenseType);
    formData.set("estimatedAmount", estimatedAmount);
    formData.set("categoryId", categoryId);
    if (editingItem) {
      formData.set("expenseItemId", editingItem.id);
    }

    startTransition(async () => {
      const result = editingItem
        ? await updateExpenseItemAction(tenantId, tenantSlug, {}, formData)
        : await createExpenseItemAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success(editingItem ? "Expense item updated" : "Expense item added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingItem ? "Edit expense item" : "Add expense item"}</DialogTitle>
          <DialogDescription>
            {editingItem ? "All fields stay editable after creation." : "Set up a new type of expense your team can record against."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expense-item-name">Expense name</Label>
            <Input
              id="expense-item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Electricity"
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-item-type">Type</Label>
            <select
              id="expense-item-type"
              value={expenseType}
              onChange={(e) => setExpenseType(e.target.value as ExpenseItemType)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="recurring">Recurring</option>
              <option value="one_time">One-Time</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-item-estimate">Estimated amount (optional)</Label>
            <Input
              id="expense-item-estimate"
              type="number"
              min="0"
              step="0.01"
              value={estimatedAmount}
              onChange={(e) => setEstimatedAmount(e.target.value)}
              placeholder="A guide only -- never enforced"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expense-item-category">Category (optional)</Label>
            <select
              id="expense-item-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Saving..." : editingItem ? "Save changes" : "Add expense item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
