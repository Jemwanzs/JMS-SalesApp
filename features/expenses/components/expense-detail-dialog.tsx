"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";

import { correctExpenseAction } from "@/features/expenses/actions/correct-expense";
import { markExpenseReimbursedAction } from "@/features/expenses/actions/mark-expense-reimbursed";
import { voidExpenseAction } from "@/features/expenses/actions/void-expense";
import { ExpenseCategoryCombobox } from "@/features/expenses/components/expense-category-combobox";
import { ExpenseCorrectionsHistory } from "@/features/expenses/components/expense-corrections-history";
import { ExpenseItemCombobox } from "@/features/expenses/components/expense-item-combobox";
import { ExpensePaymentMethodSelect } from "@/features/expenses/components/expense-payment-method-select";
import { ExpenseSplitSiblings } from "@/features/expenses/components/expense-split-siblings";
import { ReceiptUpload, type ExpenseReceiptValue } from "@/features/expenses/components/receipt-upload";
import { ReceiptViewer } from "@/features/expenses/components/receipt-viewer";
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
import type { ExpenseRecord } from "@/services/ExpenseService";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";

/**
 * Tap an existing expense row -- correct any field (date/item/category/
 * amount/vendor/payment-method/reference/tax/reimbursable/notes/receipt)
 * with a required reason (expenses.edit), or void it with a required
 * reason (expenses.void). Correction is a direct in-place update
 * (correct_expense() RPC, migration 0082), deliberately simpler than
 * sales' full correction-request workflow -- expenses carry far lower
 * stakes than a sale, and the feature is explicitly meant to stay
 * lightweight (see migration 0054's header comment) -- but now, unlike
 * the original edit_expense(), it requires a reason and writes a
 * structured before/after record (expense_corrections) rather than
 * silently overwriting.
 */
export function ExpenseDetailDialog({
  tenantId,
  tenantSlug,
  timezone,
  todayDate,
  expense,
  activeItems,
  recentlyUsedItemIds,
  categories,
  paymentMethods,
  knownVendors,
  canEdit,
  canVoid,
  canViewReceipt,
  canDownloadReceipt,
  canManageReimbursements,
  onOpenChange,
}: {
  tenantId: string;
  tenantSlug: string;
  timezone: string;
  todayDate: string;
  expense: ExpenseRecord | null;
  activeItems: ExpenseItem[];
  recentlyUsedItemIds: string[];
  categories: ExpenseCategory[];
  paymentMethods: ExpensePaymentMethod[];
  knownVendors: string[];
  canEdit: boolean;
  canVoid: boolean;
  canViewReceipt: boolean;
  canDownloadReceipt: boolean;
  canManageReimbursements: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [expenseItemId, setExpenseItemId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [actualAmount, setActualAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [vendor, setVendor] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [reimbursable, setReimbursable] = useState(false);
  const [receipt, setReceipt] = useState<ExpenseReceiptValue | null>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [reimbursing, setReimbursing] = useState(false);
  const [reimbursementReference, setReimbursementReference] = useState("");
  const [reimbursementNotes, setReimbursementNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!expense) return;
    setExpenseItemId(expense.expenseItemId);
    setCategoryId(expense.categoryId ?? "");
    setPaymentMethodId(expense.paymentMethodId ?? "");
    setActualAmount(String(expense.actualAmount));
    setExpenseDate(expense.expenseDate);
    setVendor(expense.vendor ?? "");
    setReferenceNumber(expense.referenceNumber ?? "");
    setTaxAmount(expense.taxAmount != null ? String(expense.taxAmount) : "");
    setReimbursable(expense.reimbursable);
    setReceipt(expense.receiptStoragePath ? { storagePath: expense.receiptStoragePath, fileType: expense.receiptFileType ?? "" } : null);
    setNotes(expense.notes ?? "");
    setReason("");
    setVoiding(false);
    setVoidReason("");
    setReimbursing(false);
    setReimbursementReference("");
    setReimbursementNotes("");
    setError(null);
  }, [expense]);

  function onSaveCorrection(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    setError(null);

    if (!reason.trim()) {
      setError("A reason is required to correct this expense");
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
    formData.set("expenseId", expense.id);
    formData.set("reason", reason);
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
      const result = await correctExpenseAction(tenantId, tenantSlug, timezone, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Expense corrected");
      onOpenChange(false);
    });
  }

  function onConfirmVoid(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    if (!voidReason.trim()) {
      setError("A reason is required");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("expenseId", expense.id);
    formData.set("reason", voidReason);

    startTransition(async () => {
      const result = await voidExpenseAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Expense voided");
      onOpenChange(false);
    });
  }

  function onConfirmReimbursed(e: React.FormEvent) {
    e.preventDefault();
    if (!expense) return;
    setError(null);

    const formData = new FormData();
    formData.set("expenseId", expense.id);
    formData.set("reference", reimbursementReference);
    formData.set("notes", reimbursementNotes);

    startTransition(async () => {
      const result = await markExpenseReimbursedAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Expense marked as reimbursed");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={expense !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {expense && (
          <>
            <DialogHeader>
              <DialogTitle>{expense.expenseItemName}</DialogTitle>
              <DialogDescription>
                {expense.expenseNumber && <>{expense.expenseNumber} &middot; </>}
                Recorded by {expense.recordedByName ?? "a team member"} on {expense.expenseDate}
              </DialogDescription>
            </DialogHeader>

            {expense.receiptStoragePath && (canViewReceipt || canDownloadReceipt) && (
              <ReceiptViewer
                tenantId={tenantId}
                storagePath={expense.receiptStoragePath}
                fileType={expense.receiptFileType}
                canView={canViewReceipt}
                canDownload={canDownloadReceipt}
              />
            )}

            {expense.reimbursementStatus === "paid" && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Reimbursed</p>
                <p className="text-xs text-muted-foreground">
                  {expense.reimbursedAt && new Date(expense.reimbursedAt).toLocaleDateString()}
                  {expense.reimbursementReference && ` · Ref: ${expense.reimbursementReference}`}
                </p>
              </div>
            )}

            {expense.splitGroupId && (
              <ExpenseSplitSiblings tenantId={tenantId} splitGroupId={expense.splitGroupId} expenseId={expense.id} />
            )}

            {!voiding && !reimbursing ? (
              <form onSubmit={onSaveCorrection} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="correct-item">Expense item</Label>
                  <ExpenseItemCombobox
                    id="correct-item"
                    items={activeItems}
                    value={expenseItemId}
                    onChange={setExpenseItemId}
                    recentlyUsedIds={recentlyUsedItemIds}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="correct-category">Category</Label>
                  <ExpenseCategoryCombobox id="correct-category" categories={categories} value={categoryId} onChange={setCategoryId} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="correct-amount">Actual amount</Label>
                  <Input
                    id="correct-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={actualAmount}
                    onChange={(e) => setActualAmount(e.target.value)}
                    disabled={!canEdit}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="correct-payment-method">Payment method</Label>
                  <ExpensePaymentMethodSelect
                    id="correct-payment-method"
                    paymentMethods={paymentMethods}
                    value={paymentMethodId}
                    onChange={setPaymentMethodId}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="correct-date">Date</Label>
                  <Input
                    id="correct-date"
                    type="date"
                    max={todayDate}
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    disabled={!canEdit}
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
                      <ReceiptUpload tenantId={tenantId} expenseId={expense.id} value={receipt} onChange={setReceipt} />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="correct-vendor">Vendor / Merchant (optional)</Label>
                      <VendorAutocompleteInput id="correct-vendor" value={vendor} onChange={setVendor} knownVendors={knownVendors} />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="correct-reference">Reference number (optional)</Label>
                      <Input id="correct-reference" value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="correct-tax">Tax amount (optional)</Label>
                      <Input
                        id="correct-tax"
                        type="number"
                        min="0"
                        step="0.01"
                        value={taxAmount}
                        onChange={(e) => setTaxAmount(e.target.value)}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Checkbox id="correct-reimbursable" checked={reimbursable} onCheckedChange={(v) => setReimbursable(v === true)} />
                      <Label htmlFor="correct-reimbursable" className="font-normal">
                        This was paid from personal funds (reimbursable)
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="correct-notes">Notes (optional)</Label>
                      <Input id="correct-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} />
                    </div>
                  </CollapsiblePanel>
                </Collapsible>

                {canEdit && (
                  <div className="space-y-2">
                    <Label htmlFor="correct-reason">Reason for this correction</Label>
                    <Input
                      id="correct-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="What was wrong, and what changed?"
                      required
                    />
                  </div>
                )}

                <ExpenseCorrectionsHistory tenantId={tenantId} expenseId={expense.id} />

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                  {canEdit && (
                    <Button type="submit" disabled={isPending} className="w-full">
                      {isPending ? "Saving..." : "Save correction"}
                    </Button>
                  )}
                  {canManageReimbursements && expense.reimbursable && expense.reimbursementStatus === "pending" && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setReimbursing(true);
                        setError(null);
                      }}
                    >
                      Mark as reimbursed
                    </Button>
                  )}
                  {canVoid && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full text-destructive hover:text-destructive"
                      onClick={() => {
                        setVoiding(true);
                        setError(null);
                      }}
                    >
                      Void this expense
                    </Button>
                  )}
                </DialogFooter>
              </form>
            ) : voiding ? (
              <form onSubmit={onConfirmVoid} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="void-reason">Reason for voiding</Label>
                  <Input
                    id="void-reason"
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="What happened?"
                    autoFocus
                    required
                  />
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                  <Button type="submit" variant="destructive" disabled={isPending} className="w-full">
                    {isPending ? "Voiding..." : "Confirm void"}
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={() => setVoiding(false)}>
                    Cancel
                  </Button>
                </DialogFooter>
              </form>
            ) : (
              <form onSubmit={onConfirmReimbursed} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reimbursement-reference">Payment reference (optional)</Label>
                  <Input
                    id="reimbursement-reference"
                    value={reimbursementReference}
                    onChange={(e) => setReimbursementReference(e.target.value)}
                    placeholder="e.g. M-Pesa code, cheque number"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reimbursement-notes">Notes (optional)</Label>
                  <Input
                    id="reimbursement-notes"
                    value={reimbursementNotes}
                    onChange={(e) => setReimbursementNotes(e.target.value)}
                  />
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <DialogFooter className="flex-col gap-2 sm:flex-col">
                  <Button type="submit" disabled={isPending} className="w-full">
                    {isPending ? "Saving..." : "Confirm reimbursed"}
                  </Button>
                  <Button type="button" variant="outline" className="w-full" onClick={() => setReimbursing(false)}>
                    Cancel
                  </Button>
                </DialogFooter>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
