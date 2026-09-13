"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseService } from "@/services/ExpenseService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { markExpenseReimbursedSchema, type MarkExpenseReimbursedInput } from "@/validations/expense";

export interface MarkExpenseReimbursedState {
  error?: string;
  fieldErrors?: Partial<Record<keyof MarkExpenseReimbursedInput, string>>;
  success?: boolean;
}

export async function markExpenseReimbursedAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: MarkExpenseReimbursedState,
  formData: FormData
): Promise<MarkExpenseReimbursedState> {
  // formData.get(...) returns `null`, not `undefined`, for a field that
  // was never set -- z.string().optional() only tolerates `undefined`.
  // See resolve-approval.ts's own note on the bug this exact shape caused.
  const parsed = markExpenseReimbursedSchema.safeParse({
    expenseId: formData.get("expenseId"),
    reference: formData.get("reference") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof MarkExpenseReimbursedInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.manage_reimbursements", { tenantId });

    await new ExpenseService(supabase).markReimbursed(
      parsed.data.expenseId,
      parsed.data.reference ?? null,
      parsed.data.notes ?? null
    );

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_REIMBURSED,
        entityType: "expenses",
        entityId: parsed.data.expenseId,
        newValues: { reference: parsed.data.reference ?? null },
        reason: parsed.data.notes ?? null,
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not mark this expense as reimbursed" };
  }

  revalidatePath(`/t/${tenantSlug}/expenses`);
  revalidatePath(`/t/${tenantSlug}/expenses/analytics`);
  return { success: true };
}
