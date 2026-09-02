"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { setExpenseItemStatusAction } from "@/features/expenses/actions/archive-expense-item";
import { ExpenseItemFormDialog } from "@/features/expenses/components/expense-item-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExpenseItem } from "@/services/ExpenseItemService";

export function ExpenseItemManagementList({
  tenantId,
  tenantSlug,
  expenseItems,
}: {
  tenantId: string;
  tenantSlug: string;
  expenseItems: ExpenseItem[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ExpenseItem | null>(null);
  const [isPending, startTransition] = useTransition();

  function openAdd() {
    setEditingItem(null);
    setDialogOpen(true);
  }
  function openEdit(item: ExpenseItem) {
    setEditingItem(item);
    setDialogOpen(true);
  }
  function toggleStatus(item: ExpenseItem) {
    startTransition(async () => {
      const result = await setExpenseItemStatusAction(
        tenantId,
        tenantSlug,
        item.id,
        item.status === "active" ? "archived" : "active"
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(item.status === "active" ? "Archived" : "Reactivated");
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Button onClick={openAdd} className="w-full">
        <Plus className="h-4 w-4" />
        Add expense item
      </Button>

      {expenseItems.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No expense items configured yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {expenseItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => openEdit(item)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{item.name}</p>
                  <Badge variant="outline" className="shrink-0">
                    {item.expenseType === "recurring" ? "Recurring" : "One-Time"}
                  </Badge>
                  {item.status === "archived" && (
                    <Badge variant="secondary" className="shrink-0">
                      Archived
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {item.estimatedAmount != null ? `Estimated: ${item.estimatedAmount.toFixed(2)}` : "No estimate set"}
                </p>
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => toggleStatus(item)}
              >
                {item.status === "active" ? "Archive" : "Reactivate"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ExpenseItemFormDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingItem={editingItem}
      />
    </div>
  );
}
