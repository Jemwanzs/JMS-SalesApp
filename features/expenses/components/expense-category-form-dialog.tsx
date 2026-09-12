"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { createExpenseCategoryAction } from "@/features/expenses/actions/create-expense-category";
import { updateExpenseCategoryAction } from "@/features/expenses/actions/update-expense-category";
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
import { Switch } from "@/components/ui/switch";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";

/** One dialog for both Add and Edit, same mode-driven-by-selected-record idiom as ExpenseItemFormDialog. */
export function ExpenseCategoryFormDialog({
  tenantId,
  tenantSlug,
  open,
  onOpenChange,
  editingCategory,
}: {
  tenantId: string;
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCategory: ExpenseCategory | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [receiptRequired, setReceiptRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingCategory?.name ?? "");
    setReceiptRequired(editingCategory?.receiptRequired ?? false);
    setError(null);
  }, [open, editingCategory]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("receiptRequired", receiptRequired ? "true" : "");
    if (editingCategory) {
      formData.set("categoryId", editingCategory.id);
    }

    startTransition(async () => {
      const result = editingCategory
        ? await updateExpenseCategoryAction(tenantId, tenantSlug, {}, formData)
        : await createExpenseCategoryAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success(editingCategory ? "Category updated" : "Category added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingCategory ? "Edit category" : "Add category"}</DialogTitle>
          <DialogDescription>
            {editingCategory ? "All fields stay editable after creation." : "Group expense items under a category, e.g. Rent, Transport, Utilities."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expense-category-name">Category name</Label>
            <Input
              id="expense-category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Transport"
              autoFocus
              required
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="expense-category-receipt" className="font-normal text-muted-foreground">
              Always require a receipt for expenses in this category
            </Label>
            <Switch id="expense-category-receipt" checked={receiptRequired} onCheckedChange={setReceiptRequired} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Saving..." : editingCategory ? "Save changes" : "Add category"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
