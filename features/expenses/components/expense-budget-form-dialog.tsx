"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { createExpenseBudgetAction } from "@/features/expenses/actions/create-expense-budget";
import { updateExpenseBudgetAction } from "@/features/expenses/actions/update-expense-budget";
import { ExpenseCategoryCombobox } from "@/features/expenses/components/expense-category-combobox";
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
import type { ExpenseBudget } from "@/services/ExpenseBudgetService";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { LocationSummary } from "@/services/LocationService";

/**
 * One dialog for both Add and Edit, same mode-driven-by-selected-record
 * idiom as ExpenseCategoryFormDialog. Branch is a plain select (same
 * reasoning ExpensePaymentMethodSelect already gives for a short,
 * non-searchable list) -- for a single-branch tenant it's effectively
 * pre-filled and never touched.
 */
export function ExpenseBudgetFormDialog({
  tenantId,
  tenantSlug,
  open,
  onOpenChange,
  editingBudget,
  categories,
  locations,
}: {
  tenantId: string;
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingBudget: ExpenseBudget | null;
  categories: ExpenseCategory[];
  locations: LocationSummary[];
}) {
  const [isPending, startTransition] = useTransition();
  const [locationId, setLocationId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [monthlyAmount, setMonthlyAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocationId(editingBudget?.locationId ?? locations[0]?.id ?? "");
    setCategoryId(editingBudget?.categoryId ?? "");
    setMonthlyAmount(editingBudget ? String(editingBudget.monthlyAmount) : "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingBudget]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!locationId) {
      setError("Select a branch");
      return;
    }
    if (!categoryId) {
      setError("Select a category");
      return;
    }

    const formData = new FormData();
    formData.set("locationId", locationId);
    formData.set("categoryId", categoryId);
    formData.set("monthlyAmount", monthlyAmount);
    if (editingBudget) {
      formData.set("budgetId", editingBudget.id);
    }

    startTransition(async () => {
      const result = editingBudget
        ? await updateExpenseBudgetAction(tenantId, tenantSlug, {}, formData)
        : await createExpenseBudgetAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success(editingBudget ? "Budget updated" : "Budget added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingBudget ? "Edit budget" : "Add budget"}</DialogTitle>
          <DialogDescription>
            A monthly spend cap for one category at one branch. Purely a guide -- recording an expense is never blocked by going over.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {locations.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="budget-location">Branch</Label>
              <select
                id="budget-location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
              >
                <option value="">Select a branch</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="budget-category">Category</Label>
            <ExpenseCategoryCombobox id="budget-category" categories={categories} value={categoryId} onChange={setCategoryId} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="budget-amount">Monthly amount</Label>
            <Input
              id="budget-amount"
              type="number"
              min="0"
              step="0.01"
              value={monthlyAmount}
              onChange={(e) => setMonthlyAmount(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Saving..." : editingBudget ? "Save changes" : "Add budget"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
