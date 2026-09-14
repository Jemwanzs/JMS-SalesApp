"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { setExpenseBudgetStatusAction } from "@/features/expenses/actions/archive-expense-budget";
import { ExpenseBudgetFormDialog } from "@/features/expenses/components/expense-budget-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExpenseBudget } from "@/services/ExpenseBudgetService";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { LocationSummary } from "@/services/LocationService";

export function ExpenseBudgetManagementList({
  tenantId,
  tenantSlug,
  budgets,
  categories,
  locations,
}: {
  tenantId: string;
  tenantSlug: string;
  budgets: ExpenseBudget[];
  categories: ExpenseCategory[];
  locations: LocationSummary[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<ExpenseBudget | null>(null);
  const [isPending, startTransition] = useTransition();

  // `categories` here is the full (active + archived) list, needed so an
  // already-configured budget against a since-archived category still
  // resolves its name below -- but the combobox for picking/changing a
  // budget's category should only ever offer active ones.
  const activeCategories = categories.filter((c) => c.status === "active");
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));

  function openAdd() {
    setEditingBudget(null);
    setDialogOpen(true);
  }
  function openEdit(budget: ExpenseBudget) {
    setEditingBudget(budget);
    setDialogOpen(true);
  }
  function toggleStatus(budget: ExpenseBudget) {
    startTransition(async () => {
      const result = await setExpenseBudgetStatusAction(tenantId, tenantSlug, budget.id, budget.status === "active" ? "archived" : "active");
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(budget.status === "active" ? "Archived" : "Reactivated");
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Button onClick={openAdd} className="w-full" disabled={activeCategories.length === 0 || locations.length === 0}>
        <Plus className="h-4 w-4" />
        Add budget
      </Button>

      {budgets.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No budgets configured yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {budgets.map((budget) => (
            <div key={budget.id} className="flex items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => openEdit(budget)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{categoryNameById.get(budget.categoryId) ?? "Unknown category"}</p>
                  {budget.status === "archived" && (
                    <Badge variant="secondary" className="shrink-0">
                      Archived
                    </Badge>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {locationNameById.get(budget.locationId) ?? "Unknown branch"} &middot; {budget.monthlyAmount.toFixed(2)}/mo
                </p>
              </button>
              <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => toggleStatus(budget)}>
                {budget.status === "active" ? "Archive" : "Reactivate"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ExpenseBudgetFormDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingBudget={editingBudget}
        categories={activeCategories}
        locations={locations}
      />
    </div>
  );
}
