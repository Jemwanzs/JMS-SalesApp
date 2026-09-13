"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { setExpenseCategoryStatusAction } from "@/features/expenses/actions/archive-expense-category";
import { ExpenseCategoryFormDialog } from "@/features/expenses/components/expense-category-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";

export function ExpenseCategoryManagementList({
  tenantId,
  tenantSlug,
  categories,
}: {
  tenantId: string;
  tenantSlug: string;
  categories: ExpenseCategory[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ExpenseCategory | null>(null);
  const [isPending, startTransition] = useTransition();

  function openAdd() {
    setEditingCategory(null);
    setDialogOpen(true);
  }
  function openEdit(category: ExpenseCategory) {
    setEditingCategory(category);
    setDialogOpen(true);
  }
  function toggleStatus(category: ExpenseCategory) {
    startTransition(async () => {
      const result = await setExpenseCategoryStatusAction(
        tenantId,
        tenantSlug,
        category.id,
        category.status === "active" ? "archived" : "active"
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(category.status === "active" ? "Archived" : "Reactivated");
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Button onClick={openAdd} className="w-full">
        <Plus className="h-4 w-4" />
        Add category
      </Button>

      {categories.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No categories configured yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => openEdit(category)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{category.name}</p>
                  {category.receiptRequired && (
                    <Badge variant="outline" className="shrink-0">
                      Receipt required
                    </Badge>
                  )}
                  {category.requiresApproval && (
                    <Badge variant="outline" className="shrink-0">
                      Requires approval
                    </Badge>
                  )}
                  {category.status === "archived" && (
                    <Badge variant="secondary" className="shrink-0">
                      Archived
                    </Badge>
                  )}
                </div>
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => toggleStatus(category)}
              >
                {category.status === "active" ? "Archive" : "Reactivate"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ExpenseCategoryFormDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingCategory={editingCategory}
      />
    </div>
  );
}
