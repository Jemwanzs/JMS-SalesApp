"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseService } from "@/services/ExpenseService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { todayString } from "@/lib/utils/date-ranges";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { correctExpenseSchema, type CorrectExpenseInput } from "@/validations/expense";

export interface CorrectExpenseState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CorrectExpenseInput, string>>;
  success?: boolean;
}

/**
 * Replaces editExpenseAction -- correction now covers every field
 * (date/item/category/amount/vendor/payment-method/reference/tax/
 * reimbursable/notes/receipt), requires a reason, and the DB function
 * (correct_expense(), migration 0082) writes a structured
 * expense_corrections row alongside this action's own AuditService call
 * -- both, matching how sales corrections keep a structured table AND an
 * action-layer audit log, not either/or.
 */
export async function correctExpenseAction(
  tenantId: string,
  tenantSlug: string,
  timezone: string,
  _prevState: CorrectExpenseState,
  formData: FormData
): Promise<CorrectExpenseState> {
  const parsed = correctExpenseSchema.safeParse({
    expenseId: formData.get("expenseId"),
    reason: formData.get("reason"),
    expenseItemId: formData.get("expenseItemId"),
    categoryId: formData.get("categoryId"),
    paymentMethodId: formData.get("paymentMethodId"),
    actualAmount: formData.get("actualAmount"),
    expenseDate: formData.get("expenseDate"),
    vendor: formData.get("vendor"),
    referenceNumber: formData.get("referenceNumber"),
    taxAmount: formData.get("taxAmount"),
    reimbursable: formData.get("reimbursable"),
    receiptStoragePath: formData.get("receiptStoragePath") || undefined,
    receiptFileType: formData.get("receiptFileType") || undefined,
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof CorrectExpenseInput>(parsed.error.issues) };
  }
  if (parsed.data.expenseDate > todayString(timezone)) {
    return { fieldErrors: { expenseDate: "The expense date cannot be in the future" } };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.edit", { tenantId });

    await new ExpenseService(supabase).correctExpense({
      expenseId: parsed.data.expenseId,
      reason: parsed.data.reason,
      expenseItemId: parsed.data.expenseItemId,
      categoryId: parsed.data.categoryId,
      paymentMethodId: parsed.data.paymentMethodId,
      actualAmount: parsed.data.actualAmount,
      expenseDate: parsed.data.expenseDate,
      vendor: parsed.data.vendor || null,
      referenceNumber: parsed.data.referenceNumber || null,
      taxAmount: parsed.data.taxAmount === "" || parsed.data.taxAmount == null ? null : Number(parsed.data.taxAmount),
      reimbursable: parsed.data.reimbursable ?? false,
      notes: parsed.data.notes || null,
      receiptStoragePath: parsed.data.receiptStoragePath || null,
      receiptFileType: parsed.data.receiptFileType || null,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_CORRECTED,
        entityType: "expenses",
        entityId: parsed.data.expenseId,
        reason: parsed.data.reason,
        newValues: { actualAmount: parsed.data.actualAmount, expenseDate: parsed.data.expenseDate },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not correct this expense" };
  }

  revalidatePath(`/t/${tenantSlug}/expenses`);
  revalidatePath(`/t/${tenantSlug}/expenses/analytics`);
  return { success: true };
}
