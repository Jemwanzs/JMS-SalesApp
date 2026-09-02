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
import { editExpenseSchema, type EditExpenseInput } from "@/validations/expense";

export interface EditExpenseState {
  error?: string;
  fieldErrors?: Partial<Record<keyof EditExpenseInput, string>>;
  success?: boolean;
}

export async function editExpenseAction(
  tenantId: string,
  tenantSlug: string,
  timezone: string,
  _prevState: EditExpenseState,
  formData: FormData
): Promise<EditExpenseState> {
  const parsed = editExpenseSchema.safeParse({
    expenseId: formData.get("expenseId"),
    actualAmount: formData.get("actualAmount"),
    expenseDate: formData.get("expenseDate"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof EditExpenseInput>(parsed.error.issues) };
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

    await new ExpenseService(supabase).editExpense({
      expenseId: parsed.data.expenseId,
      actualAmount: parsed.data.actualAmount,
      expenseDate: parsed.data.expenseDate,
      notes: parsed.data.notes || null,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_EDITED,
        entityType: "expenses",
        entityId: parsed.data.expenseId,
        newValues: { actualAmount: parsed.data.actualAmount, expenseDate: parsed.data.expenseDate },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not edit this expense" };
  }

  revalidatePath(`/t/${tenantSlug}/expenses`);
  revalidatePath(`/t/${tenantSlug}/expenses/analytics`);
  return { success: true };
}
