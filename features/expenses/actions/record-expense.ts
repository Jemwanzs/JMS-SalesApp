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
import { recordExpenseSchema, type RecordExpenseInput } from "@/validations/expense";

export interface RecordExpenseState {
  error?: string;
  fieldErrors?: Partial<Record<keyof RecordExpenseInput, string>>;
  success?: boolean;
  expense?: ExpenseRecord;
}

export async function recordExpenseAction(
  tenantId: string,
  tenantSlug: string,
  timezone: string,
  _prevState: RecordExpenseState,
  formData: FormData
): Promise<RecordExpenseState> {
  const parsed = recordExpenseSchema.safeParse({
    expenseItemId: formData.get("expenseItemId"),
    actualAmount: formData.get("actualAmount"),
    expenseDate: formData.get("expenseDate"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof RecordExpenseInput>(parsed.error.issues) };
  }

  // Belt-and-suspenders with the DB check constraint (expense_date <=
  // current_date) -- a friendlier error before the query ever fires,
  // computed against the tenant's own timezone rather than server UTC,
  // same principle BusinessDayService applies to "today" everywhere else.
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

  let expense: ExpenseRecord;
  try {
    await assertCan("expenses.create", { tenantId });

    const locationId = await resolveActiveLocationId(supabase, tenantId);
    if (!locationId) {
      return { error: "Could not resolve your active branch -- please sign in again." };
    }

    expense = await new ExpenseService(supabase).recordExpense(tenantId, {
      locationId,
      expenseItemId: parsed.data.expenseItemId,
      actualAmount: parsed.data.actualAmount,
      expenseDate: parsed.data.expenseDate,
      notes: parsed.data.notes || null,
      recordedBy: user.id,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_RECORDED,
        entityType: "expenses",
        entityId: expense.id,
        newValues: { expenseItemName: expense.expenseItemName, actualAmount: expense.actualAmount, expenseDate: expense.expenseDate },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record this expense" };
  }

  revalidatePath(`/t/${tenantSlug}/expenses`);
  revalidatePath(`/t/${tenantSlug}/expenses/analytics`);
  return { success: true, expense };
}
