"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { recordExpenseAction } from "@/features/expenses/actions/record-expense";
import { recordSplitExpenseAction } from "@/features/expenses/actions/record-split-expense";
import { ExpenseCategoryCombobox } from "@/features/expenses/components/expense-category-combobox";
import { ExpenseItemCombobox } from "@/features/expenses/components/expense-item-combobox";
import { ExpensePaymentMethodSelect } from "@/features/expenses/components/expense-payment-method-select";
import { ExpenseSplitRows, newSplitRow, type ExpenseSplitRowValue } from "@/features/expenses/components/expense-split-rows";
import { ReceiptUpload, type ExpenseReceiptValue } from "@/features/expenses/components/receipt-upload";
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
import type { ExpenseBudgetStatusEntry } from "@/services/ExpenseBudgetService";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { ExpenseItem } from "@/services/ExpenseItemService";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";

/**
 * "+ Add Expense" -- select a configured Expense Item, category, and
 * payment method (required, per the fast-entry spec), see the item's
 * estimated amount as plain reference text (never a constraint on the
 * Actual Amount field), enter the real amount, and a date that defaults
 * to today and can only move backward (`max` = today, re-checked
 * server-side too). Vendor/reference number/tax/reimbursable/notes sit
 * under a "More Details" disclosure so the common case -- item, amount,
 * done -- stays a few taps, not a long form. Same "tap an item, get a
 * focused form" idiom RecordSaleDialog/QuickStockEntryDialog already use.
 */
export function RecordExpenseDialog({
  tenantId,
  tenantSlug,
  timezone,
  todayDate,
  open,
  onOpenChange,
  activeItems,
  recentlyUsedItemIds,
  categories,
  paymentMethods,
  defaultPaymentMethodId,
  knownVendors,
  budgetStatus,
}: {
  tenantId: string;
  tenantSlug: string;
  timezone: string;
  todayDate: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeItems: ExpenseItem[];
  recentlyUsedItemIds: string[];
  categories: ExpenseCategory[];
  paymentMethods: ExpensePaymentMethod[];
  defaultPaymentMethodId: string;
  knownVendors: string[];
  budgetStatus: ExpenseBudgetStatusEntry[];
}) {
  const [isPending, startTransition] = useTransition();
  // Starts unset (no item pre-selected) -- the searchable combobox
  // requires an explicit tap-to-select, so silently defaulting to the
  // first item would make it easy to record an expense against the
  // wrong one without noticing.
  const [expenseItemId, setExpenseItemId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(defaultPaymentMethodId);
  const [actualAmount, setActualAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayDate);
  const [vendor, setVendor] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [reimbursable, setReimbursable] = useState(false);
  const [receipt, setReceipt] = useState<ExpenseReceiptValue | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Generated fresh each time the dialog opens -- lets a receipt upload
  // to Storage under {expenseId}/... before this row exists in the DB
  // (ExpenseService.RecordExpenseInput.id, same trick ProductService's
  // own client-generated id uses).
  const [pendingExpenseId, setPendingExpenseId] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [splitRows, setSplitRows] = useState<ExpenseSplitRowValue[]>([]);

  useEffect(() => {
    if (!open) return;
    setExpenseItemId("");
    setCategoryId("");
    setPaymentMethodId(defaultPaymentMethodId);
    setActualAmount("");
    setExpenseDate(todayDate);
    setVendor("");
    setReferenceNumber("");
    setTaxAmount("");
    setReimbursable(false);
    setReceipt(null);
    setNotes("");
    setError(null);
    setPendingExpenseId(crypto.randomUUID());
    setSplitMode(false);
    setSplitRows([newSplitRow(), newSplitRow()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedItem = activeItems.find((i) => i.id === expenseItemId) ?? null;
  // Purely advisory -- never blocks submission (see migration 0087's own
  // header comment). Recomputed from the SAME budgetStatus snapshot the
  // dashboard already loaded for this branch, not a fresh query -- the
  // few minutes of staleness while the dialog is open doesn't matter for
  // a heads-up like this.
  const selectedBudget = budgetStatus.find((b) => b.categoryId === categoryId) ?? null;
  const projectedSpend = selectedBudget && actualAmount ? selectedBudget.spent + Number(actualAmount) : null;
  const overBudget = selectedBudget && projectedSpend != null && projectedSpend > selectedBudget.monthlyAmount;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!expenseItemId) {
      setError("Select an expense item");
      return;
    }
    if (!paymentMethodId) {
      setError("Select a payment method");
      return;
    }

    if (splitMode) {
      if (splitRows.some((r) => !r.categoryId)) {
        setError("Select a category for every split");
        return;
      }
      if (splitRows.some((r) => !r.amount || Number(r.amount) <= 0)) {
        setError("Enter an amount greater than 0 for every split");
        return;
      }

      const formData = new FormData();
      formData.set("expenseItemId", expenseItemId);
      formData.set("paymentMethodId", paymentMethodId);
      formData.set("expenseDate", expenseDate);
      formData.set("splits", JSON.stringify(splitRows.map((r) => ({ categoryId: r.categoryId, amount: r.amount }))));
      formData.set("vendor", vendor);
      formData.set("referenceNumber", referenceNumber);
      formData.set("reimbursable", reimbursable ? "true" : "");
      if (receipt) {
        formData.set("receiptStoragePath", receipt.storagePath);
        formData.set("receiptFileType", receipt.fileType);
      }
      formData.set("notes", notes);

      startTransition(async () => {
        const result = await recordSplitExpenseAction(tenantId, tenantSlug, timezone, {}, formData);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.fieldErrors) {
          setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
          return;
        }
        const anyPending = result.expenses?.some((e) => e.status === "pending_approval");
        toast.success(anyPending ? "Split expense submitted for approval" : "Split expense recorded");
        onOpenChange(false);
      });
      return;
    }

    if (!categoryId) {
      setError("Select a category");
      return;
    }

    const formData = new FormData();
    formData.set("id", pendingExpenseId);
    formData.set("expenseItemId", expenseItemId);
    formData.set("categoryId", categoryId);
    formData.set("paymentMethodId", paymentMethodId);
    formData.set("actualAmount", actualAmount);
    formData.set("expenseDate", expenseDate);
    formData.set("vendor", vendor);
    formData.set("referenceNumber", referenceNumber);
    formData.set("taxAmount", taxAmount);
    formData.set("reimbursable", reimbursable ? "true" : "");
    if (receipt) {
      formData.set("receiptStoragePath", receipt.storagePath);
      formData.set("receiptFileType", receipt.fileType);
    }
    formData.set("notes", notes);

    startTransition(async () => {
      const result = await recordExpenseAction(tenantId, tenantSlug, timezone, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success(result.expense?.status === "pending_approval" ? "Expense submitted for approval" : "Expense recorded");
      onOpenChange(false);
    });
  }

  const noConfigYet = activeItems.length === 0 || categories.length === 0 || paymentMethods.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          {noConfigYet && (
            <DialogDescription>
              Set up at least one expense item, category, and payment method under More &rarr; Expense Setup first.
            </DialogDescription>
          )}
        </DialogHeader>

        {!noConfigYet && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="expense-item">Expense item</Label>
              <ExpenseItemCombobox
                id="expense-item"
                items={activeItems}
                value={expenseItemId}
                onChange={setExpenseItemId}
                recentlyUsedIds={recentlyUsedItemIds}
              />
              {selectedItem?.estimatedAmount != null && (
                <p className="text-xs text-muted-foreground">Estimated: {selectedItem.estimatedAmount.toFixed(2)} (a guide only)</p>
              )}
            </div>

            {!splitMode ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="expense-category">Category</Label>
                  <ExpenseCategoryCombobox id="expense-category" categories={categories} value={categoryId} onChange={setCategoryId} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expense-actual-amount">Actual amount</Label>
                  <Input
                    id="expense-actual-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={actualAmount}
                    onChange={(e) => setActualAmount(e.target.value)}
                    required
                  />
                  {overBudget && projectedSpend != null && selectedBudget && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      This will put {selectedBudget.categoryName} at {projectedSpend.toFixed(2)} of its {selectedBudget.monthlyAmount.toFixed(2)}{" "}
                      monthly budget this month.
                    </p>
                  )}
                </div>

                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSplitMode(true)}
                    className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Split into multiple categories
                  </button>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Split across categories</Label>
                  <button
                    type="button"
                    onClick={() => setSplitMode(false)}
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Use one category instead
                  </button>
                </div>
                <ExpenseSplitRows rows={splitRows} categories={categories} budgetStatus={budgetStatus} onChange={setSplitRows} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="expense-payment-method">Payment method</Label>
              <ExpensePaymentMethodSelect
                id="expense-payment-method"
                paymentMethods={paymentMethods}
                value={paymentMethodId}
                onChange={setPaymentMethodId}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="expense-date">Date</Label>
              <Input
                id="expense-date"
                type="date"
                max={todayDate}
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                required
              />
            </div>

            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
                More details
                <ChevronDown className="h-4 w-4 transition-transform group-data-open:rotate-180" />
              </CollapsibleTrigger>
              <CollapsiblePanel className="space-y-4 pt-3">
                <div className="space-y-2">
                  <Label>Receipt (optional)</Label>
                  {pendingExpenseId && (
                    <ReceiptUpload tenantId={tenantId} expenseId={pendingExpenseId} value={receipt} onChange={setReceipt} />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expense-vendor">Vendor / Merchant (optional)</Label>
                  <VendorAutocompleteInput id="expense-vendor" value={vendor} onChange={setVendor} knownVendors={knownVendors} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expense-reference">Reference number (optional)</Label>
                  <Input id="expense-reference" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
                </div>

                {!splitMode && (
                  <div className="space-y-2">
                    <Label htmlFor="expense-tax">Tax amount (optional)</Label>
                    <Input
                      id="expense-tax"
                      type="number"
                      min="0"
                      step="0.01"
                      value={taxAmount}
                      onChange={(e) => setTaxAmount(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Checkbox id="expense-reimbursable" checked={reimbursable} onCheckedChange={(v) => setReimbursable(v === true)} />
                  <Label htmlFor="expense-reimbursable" className="font-normal">
                    This was paid from personal funds (reimbursable)
                  </Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expense-notes">Notes (optional)</Label>
                  <Input id="expense-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </CollapsiblePanel>
            </Collapsible>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? "Recording..." : splitMode ? "Record split expense" : "Record expense"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
