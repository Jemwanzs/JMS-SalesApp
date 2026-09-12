"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { createExpensePaymentMethodAction } from "@/features/expenses/actions/create-expense-payment-method";
import { updateExpensePaymentMethodAction } from "@/features/expenses/actions/update-expense-payment-method";
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
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";

/** One dialog for both Add and Edit, same mode-driven-by-selected-record idiom as ExpenseItemFormDialog. */
export function ExpensePaymentMethodFormDialog({
  tenantId,
  tenantSlug,
  open,
  onOpenChange,
  editingPaymentMethod,
}: {
  tenantId: string;
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingPaymentMethod: ExpensePaymentMethod | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editingPaymentMethod?.name ?? "");
    setIsDefault(editingPaymentMethod?.isDefault ?? false);
    setError(null);
  }, [open, editingPaymentMethod]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("name", name);
    formData.set("isDefault", isDefault ? "true" : "");
    if (editingPaymentMethod) {
      formData.set("paymentMethodId", editingPaymentMethod.id);
    }

    startTransition(async () => {
      const result = editingPaymentMethod
        ? await updateExpensePaymentMethodAction(tenantId, tenantSlug, {}, formData)
        : await createExpensePaymentMethodAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success(editingPaymentMethod ? "Payment method updated" : "Payment method added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingPaymentMethod ? "Edit payment method" : "Add payment method"}</DialogTitle>
          <DialogDescription>
            {editingPaymentMethod ? "All fields stay editable after creation." : "e.g. Cash, Mobile Money, Bank, Card."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="expense-payment-method-name">Name</Label>
            <Input
              id="expense-payment-method-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cash"
              autoFocus
              required
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="expense-payment-method-default" className="font-normal text-muted-foreground">
              Use as the default payment method
            </Label>
            <Switch id="expense-payment-method-default" checked={isDefault} onCheckedChange={setIsDefault} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Saving..." : editingPaymentMethod ? "Save changes" : "Add payment method"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
