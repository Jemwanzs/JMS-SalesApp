"use client";

import { Plus, Trash2 } from "lucide-react";

import { ExpenseCategoryCombobox } from "@/features/expenses/components/expense-category-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExpenseBudgetStatusEntry } from "@/services/ExpenseBudgetService";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";

export interface ExpenseSplitRowValue {
  id: string;
  categoryId: string;
  amount: string;
}

export function newSplitRow(): ExpenseSplitRowValue {
  return { id: crypto.randomUUID(), categoryId: "", amount: "" };
}

/**
 * The repeatable category+amount rows for "split this expense across
 * multiple categories" -- one payment (item/vendor/date/payment method/
 * receipt all stay shared, entered once above this) allocated across 2+
 * categories, same shape RecordExpenseDialog's single category+amount
 * pair takes in the non-split case. Never fewer than 2 rows -- a
 * "split" of one category is just a normal expense.
 */
export function ExpenseSplitRows({
  rows,
  categories,
  budgetStatus,
  onChange,
}: {
  rows: ExpenseSplitRowValue[];
  categories: ExpenseCategory[];
  budgetStatus: ExpenseBudgetStatusEntry[];
  onChange: (rows: ExpenseSplitRowValue[]) => void;
}) {
  function updateRow(id: string, patch: Partial<ExpenseSplitRowValue>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    onChange([...rows, newSplitRow()]);
  }
  function removeRow(id: string) {
    if (rows.length <= 2) return;
    onChange(rows.filter((r) => r.id !== id));
  }

  const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  return (
    <div className="space-y-3">
      {rows.map((row, i) => {
        const budget = row.categoryId ? (budgetStatus.find((b) => b.categoryId === row.categoryId) ?? null) : null;
        const projected = budget && row.amount ? budget.spent + Number(row.amount) : null;
        const overBudget = budget && projected != null && projected > budget.monthlyAmount;

        return (
          <div key={row.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Split {i + 1}</Label>
              {rows.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove split ${i + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <ExpenseCategoryCombobox
              id={`split-category-${i}`}
              categories={categories}
              value={row.categoryId}
              onChange={(v) => updateRow(row.id, { categoryId: v })}
            />

            <Input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="Amount"
              value={row.amount}
              onChange={(e) => updateRow(row.id, { amount: e.target.value })}
            />

            {overBudget && projected != null && budget && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This will put {budget.categoryName} at {projected.toFixed(2)} of its {budget.monthlyAmount.toFixed(2)} monthly budget this month.
              </p>
            )}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" className="w-full" onClick={addRow}>
        <Plus className="h-4 w-4" />
        Add another category
      </Button>

      <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3">
        <span className="text-sm font-medium">Total</span>
        <span className="text-sm font-semibold tabular-nums">{total.toFixed(2)}</span>
      </div>
    </div>
  );
}
