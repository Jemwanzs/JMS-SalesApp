"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseService, type ExpenseRecord } from "@/services/ExpenseService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { todayString } from "@/lib/utils/date-ranges";
import { recordSplitExpenseSchema, type RecordSplitExpenseInput } from "@/validations/expense";

export interface RecordSplitExpenseState {
  error?: string;
  fieldErrors?: Partial<Record<keyof RecordSplitExpenseInput, string>>;
  success?: boolean;
  expenses?: ExpenseRecord[];
}

export async function recordSplitExpenseAction(
  tenantId: string,
  tenantSlug: string,
  timezone: string,
  _prevState: RecordSplitExpenseState,
  formData: FormData
): Promise<RecordSplitExpenseState> {
  const parsed = recordSplitExpenseSchema.safeParse({
    expenseItemId: formData.get("expenseItemId"),
    paymentMethodId: formData.get("paymentMethodId"),
    expenseDate: formData.get("expenseDate"),
    splits: formData.get("splits"),
    vendor: formData.get("vendor"),
    referenceNumber: formData.get("referenceNumber"),
    reimbursable: formData.get("reimbursable"),
    receiptStoragePath: formData.get("receiptStoragePath") || undefined,
    receiptFileType: formData.get("receiptFileType") || undefined,
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof RecordSplitExpenseInput>(parsed.error.issues) };
  }

  // Same friendly-error-before-the-query belt-and-suspenders as record-expense.ts.
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

  let expenses: ExpenseRecord[];
  try {
    await assertCan("expenses.create", { tenantId });

    const locationId = await resolveActiveLocationId(supabase, tenantId);
    if (!locationId) {
      return { error: "Could not resolve your active branch -- please sign in again." };
    }

    expenses = await new ExpenseService(supabase).recordSplitExpense(tenantId, {
      locationId,
      expenseItemId: parsed.data.expenseItemId,
      paymentMethodId: parsed.data.paymentMethodId,
      expenseDate: parsed.data.expenseDate,
      splits: parsed.data.splits,
      vendor: parsed.data.vendor || null,
      referenceNumber: parsed.data.referenceNumber || null,
      reimbursable: parsed.data.reimbursable ?? false,
      receiptStoragePath: parsed.data.receiptStoragePath || null,
      receiptFileType: parsed.data.receiptFileType || null,
      notes: parsed.data.notes || null,
      recordedBy: user.id,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_SPLIT_RECORDED,
        entityType: "expenses",
        entityId: expenses[0]?.splitGroupId ?? undefined,
        newValues: {
          expenseItemName: expenses[0]?.expenseItemName,
          totalAmount: expenses.reduce((sum, e) => sum + e.actualAmount, 0),
          splitCount: expenses.length,
          expenseDate: parsed.data.expenseDate,
        },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record this split expense" };
  }

  revalidatePath(`/t/${tenantSlug}/expenses`);
  revalidatePath(`/t/${tenantSlug}/expenses/analytics`);
  return { success: true, expenses };
}
