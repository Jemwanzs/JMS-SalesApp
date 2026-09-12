"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { setExpensePaymentMethodStatusAction } from "@/features/expenses/actions/archive-expense-payment-method";
import { ExpensePaymentMethodFormDialog } from "@/features/expenses/components/expense-payment-method-form-dialog";
import { setDefaultExpensePaymentMethodAction } from "@/features/expenses/actions/set-default-expense-payment-method";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";

export function ExpensePaymentMethodManagementList({
  tenantId,
  tenantSlug,
  paymentMethods,
}: {
  tenantId: string;
  tenantSlug: string;
  paymentMethods: ExpensePaymentMethod[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<ExpensePaymentMethod | null>(null);
  const [isPending, startTransition] = useTransition();

  function openAdd() {
    setEditingPaymentMethod(null);
    setDialogOpen(true);
  }
  function openEdit(paymentMethod: ExpensePaymentMethod) {
    setEditingPaymentMethod(paymentMethod);
    setDialogOpen(true);
  }
  function toggleStatus(paymentMethod: ExpensePaymentMethod) {
    startTransition(async () => {
      const result = await setExpensePaymentMethodStatusAction(
        tenantId,
        tenantSlug,
        paymentMethod.id,
        paymentMethod.status === "active" ? "archived" : "active"
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(paymentMethod.status === "active" ? "Archived" : "Reactivated");
    });
  }
  function makeDefault(paymentMethod: ExpensePaymentMethod) {
    startTransition(async () => {
      const result = await setDefaultExpensePaymentMethodAction(tenantId, tenantSlug, paymentMethod.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Default payment method updated");
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Button onClick={openAdd} className="w-full">
        <Plus className="h-4 w-4" />
        Add payment method
      </Button>

      {paymentMethods.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No payment methods configured yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {paymentMethods.map((paymentMethod) => (
            <div key={paymentMethod.id} className="flex items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => openEdit(paymentMethod)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{paymentMethod.name}</p>
                  {paymentMethod.isDefault && (
                    <Badge variant="outline" className="shrink-0">
                      Default
                    </Badge>
                  )}
                  {paymentMethod.status === "archived" && (
                    <Badge variant="secondary" className="shrink-0">
                      Archived
                    </Badge>
                  )}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-2">
                {paymentMethod.status === "active" && !paymentMethod.isDefault && (
                  <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => makeDefault(paymentMethod)}>
                    Set default
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => toggleStatus(paymentMethod)}
                >
                  {paymentMethod.status === "active" ? "Archive" : "Reactivate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ExpensePaymentMethodFormDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingPaymentMethod={editingPaymentMethod}
      />
    </div>
  );
}
