"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { createExpenseRecurringTemplateAction } from "@/features/expenses/actions/create-expense-recurring-template";
import { updateExpenseRecurringTemplateAction } from "@/features/expenses/actions/update-expense-recurring-template";
import { ExpenseCategoryCombobox } from "@/features/expenses/components/expense-category-combobox";
import { ExpenseItemCombobox } from "@/features/expenses/components/expense-item-combobox";
import { ExpensePaymentMethodSelect } from "@/features/expenses/components/expense-payment-method-select";
import { VendorAutocompleteInput } from "@/features/expenses/components/vendor-autocomplete-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
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
import type { ExpenseItem } from "@/services/ExpenseItemService";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";
import type { ExpenseRecurringTemplate } from "@/services/ExpenseRecurringTemplateService";
import type { LocationSummary } from "@/services/LocationService";
import type { CreateExpenseRecurringTemplateInput } from "@/validations/expense";

/**
 * One dialog for both Add and Edit, same mode-driven-by-selected-record
 * idiom as ExpenseBudgetFormDialog/ExpenseCategoryFormDialog. Mirrors
 * RecordExpenseDialog's own required-fields-first, "More details"
 * disclosure shape -- a recurring template is really just "an expense
 * that fills itself in," so its form should feel like the same one.
 */
export function ExpenseRecurringTemplateFormDialog({
  tenantId,
  tenantSlug,
  open,
  onOpenChange,
  editingTemplate,
  activeItems,
  categories,
  paymentMethods,
  knownVendors,
  locations,
}: {
  tenantId: string;
  tenantSlug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingTemplate: ExpenseRecurringTemplate | null;
  activeItems: ExpenseItem[];
  categories: ExpenseCategory[];
  paymentMethods: ExpensePaymentMethod[];
  knownVendors: string[];
  locations: LocationSummary[];
}) {
  const [isPending, startTransition] = useTransition();
  const [locationId, setLocationId] = useState("");
  const [expenseItemId, setExpenseItemId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [amount, setAmount] = useState("");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [vendor, setVendor] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [reimbursable, setReimbursable] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLocationId(editingTemplate?.locationId ?? locations[0]?.id ?? "");
    setExpenseItemId(editingTemplate?.expenseItemId ?? "");
    setCategoryId(editingTemplate?.categoryId ?? "");
    setPaymentMethodId(editingTemplate?.paymentMethodId ?? paymentMethods.find((pm) => pm.isDefault)?.id ?? "");
    setAmount(editingTemplate ? String(editingTemplate.amount) : "");
    setDayOfMonth(editingTemplate ? String(editingTemplate.dayOfMonth) : "1");
    setVendor(editingTemplate?.vendor ?? "");
    setReferenceNumber(editingTemplate?.referenceNumber ?? "");
    setTaxAmount(editingTemplate?.taxAmount != null ? String(editingTemplate.taxAmount) : "");
    setReimbursable(editingTemplate?.reimbursable ?? false);
    setNotes(editingTemplate?.notes ?? "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingTemplate]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!locationId) {
      setError("Select a branch");
      return;
    }
    if (!expenseItemId) {
      setError("Select an expense item");
      return;
    }
    if (!categoryId) {
      setError("Select a category");
      return;
    }
    if (!paymentMethodId) {
      setError("Select a payment method");
      return;
    }

    const formData = new FormData();
    formData.set("locationId", locationId);
    formData.set("expenseItemId", expenseItemId);
    formData.set("categoryId", categoryId);
    formData.set("paymentMethodId", paymentMethodId);
    formData.set("amount", amount);
    formData.set("dayOfMonth", dayOfMonth);
    formData.set("vendor", vendor);
    formData.set("referenceNumber", referenceNumber);
    formData.set("taxAmount", taxAmount);
    formData.set("reimbursable", reimbursable ? "true" : "");
    formData.set("notes", notes);
    if (editingTemplate) {
      formData.set("templateId", editingTemplate.id);
    }

    startTransition(async () => {
      const result = editingTemplate
        ? await updateExpenseRecurringTemplateAction(tenantId, tenantSlug, {}, formData)
        : await createExpenseRecurringTemplateAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors as Partial<Record<keyof CreateExpenseRecurringTemplateInput, string>>)[0] ?? "Check the fields above");
        return;
      }
      toast.success(editingTemplate ? "Recurring expense updated" : "Recurring expense added");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingTemplate ? "Edit recurring expense" : "Add recurring expense"}</DialogTitle>
          <DialogDescription>
            Generates a real expense automatically on this day every month -- rent, subscriptions, anything you don&apos;t want to re-enter by hand.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          {locations.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="recurring-location">Branch</Label>
              <select
                id="recurring-location"
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
            <Label htmlFor="recurring-item">Expense item</Label>
            <ExpenseItemCombobox id="recurring-item" items={activeItems} value={expenseItemId} onChange={setExpenseItemId} recentlyUsedIds={[]} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recurring-category">Category</Label>
            <ExpenseCategoryCombobox id="recurring-category" categories={categories} value={categoryId} onChange={setCategoryId} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recurring-amount">Amount</Label>
            <Input id="recurring-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recurring-payment-method">Payment method</Label>
            <ExpensePaymentMethodSelect
              id="recurring-payment-method"
              paymentMethods={paymentMethods}
              value={paymentMethodId}
              onChange={setPaymentMethodId}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recurring-day">Day of month</Label>
            <Input
              id="recurring-day"
              type="number"
              min="1"
              max="31"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">A day past the end of a shorter month (e.g. 31 in April) lands on that month&apos;s last day instead.</p>
          </div>

          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
              More details
              <ChevronDown className="h-4 w-4 transition-transform group-data-open:rotate-180" />
            </CollapsibleTrigger>
            <CollapsiblePanel className="space-y-4 pt-3">
              <div className="space-y-2">
                <Label htmlFor="recurring-vendor">Vendor / Merchant (optional)</Label>
                <VendorAutocompleteInput id="recurring-vendor" value={vendor} onChange={setVendor} knownVendors={knownVendors} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="recurring-reference">Reference number (optional)</Label>
                <Input id="recurring-reference" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="recurring-tax">Tax amount (optional)</Label>
                <Input id="recurring-tax" type="number" min="0" step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="recurring-reimbursable" checked={reimbursable} onCheckedChange={(v) => setReimbursable(v === true)} />
                <Label htmlFor="recurring-reimbursable" className="font-normal">
                  Paid from personal funds each time (reimbursable)
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="recurring-notes">Notes (optional)</Label>
                <Input id="recurring-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
            </CollapsiblePanel>
          </Collapsible>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Saving..." : editingTemplate ? "Save changes" : "Add recurring expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
