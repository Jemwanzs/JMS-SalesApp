"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { setExpenseRecurringTemplateStatusAction } from "@/features/expenses/actions/archive-expense-recurring-template";
import { ExpenseRecurringTemplateFormDialog } from "@/features/expenses/components/expense-recurring-template-form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { ExpenseItem } from "@/services/ExpenseItemService";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";
import type { ExpenseRecurringTemplate } from "@/services/ExpenseRecurringTemplateService";
import type { LocationSummary } from "@/services/LocationService";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function ExpenseRecurringTemplateManagementList({
  tenantId,
  tenantSlug,
  templates,
  expenseItems,
  categories,
  paymentMethods,
  knownVendors,
  locations,
}: {
  tenantId: string;
  tenantSlug: string;
  templates: ExpenseRecurringTemplate[];
  expenseItems: ExpenseItem[];
  categories: ExpenseCategory[];
  paymentMethods: ExpensePaymentMethod[];
  knownVendors: string[];
  locations: LocationSummary[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ExpenseRecurringTemplate | null>(null);
  const [isPending, startTransition] = useTransition();

  // Same reasoning as ExpenseBudgetManagementList's own active-only
  // filter -- the pickers inside the form must never offer an item/
  // category/payment method already archived, even though an existing
  // template referencing one still needs to resolve its name below.
  const activeItems = expenseItems.filter((i) => i.status === "active");
  const activeCategories = categories.filter((c) => c.status === "active");
  const activePaymentMethods = paymentMethods.filter((pm) => pm.status === "active");
  const itemNameById = new Map(expenseItems.map((i) => [i.id, i.name]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
  const paymentMethodNameById = new Map(paymentMethods.map((pm) => [pm.id, pm.name]));
  const locationNameById = new Map(locations.map((l) => [l.id, l.name]));

  function openAdd() {
    setEditingTemplate(null);
    setDialogOpen(true);
  }
  function openEdit(template: ExpenseRecurringTemplate) {
    setEditingTemplate(template);
    setDialogOpen(true);
  }
  function toggleStatus(template: ExpenseRecurringTemplate) {
    startTransition(async () => {
      const result = await setExpenseRecurringTemplateStatusAction(
        tenantId,
        tenantSlug,
        template.id,
        template.status === "active" ? "archived" : "active"
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(template.status === "active" ? "Archived" : "Reactivated");
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <Button onClick={openAdd} className="w-full" disabled={activeItems.length === 0 || activeCategories.length === 0 || locations.length === 0}>
        <Plus className="h-4 w-4" />
        Add recurring expense
      </Button>

      {templates.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">No recurring expenses configured yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {templates.map((template) => (
            <div key={template.id} className="flex items-center justify-between gap-3 p-4">
              <button type="button" onClick={() => openEdit(template)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{itemNameById.get(template.expenseItemId) ?? "Unknown item"}</p>
                  <Badge variant="outline" className="shrink-0">
                    {categoryNameById.get(template.categoryId) ?? "Unknown category"}
                  </Badge>
                  {template.status === "archived" && (
                    <Badge variant="secondary" className="shrink-0">
                      Archived
                    </Badge>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {locationNameById.get(template.locationId) ?? "Unknown branch"} &middot; {paymentMethodNameById.get(template.paymentMethodId) ?? "Unknown"}
                  &middot; every {ordinal(template.dayOfMonth)}
                </p>
              </button>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <p className="font-medium tabular-nums">{template.amount.toFixed(2)}</p>
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => toggleStatus(template)}>
                  {template.status === "active" ? "Archive" : "Reactivate"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ExpenseRecurringTemplateFormDialog
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingTemplate={editingTemplate}
        activeItems={activeItems}
        categories={activeCategories}
        paymentMethods={activePaymentMethods}
        knownVendors={knownVendors}
        locations={locations}
      />
    </div>
  );
}
