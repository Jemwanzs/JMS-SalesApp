"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseService } from "@/services/ExpenseService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { voidExpenseSchema, type VoidExpenseInput } from "@/validations/expense";

export interface VoidExpenseState {
  error?: string;
  fieldErrors?: Partial<Record<keyof VoidExpenseInput, string>>;
  success?: boolean;
}

export async function voidExpenseAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: VoidExpenseState,
  formData: FormData
): Promise<VoidExpenseState> {
  const parsed = voidExpenseSchema.safeParse({
    expenseId: formData.get("expenseId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof VoidExpenseInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.void", { tenantId });

    await new ExpenseService(supabase).voidExpense(parsed.data.expenseId, parsed.data.reason);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_VOIDED,
        entityType: "expenses",
        entityId: parsed.data.expenseId,
        reason: parsed.data.reason,
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not void this expense" };
  }

  revalidatePath(`/t/${tenantSlug}/expenses`);
  revalidatePath(`/t/${tenantSlug}/expenses/analytics`);
  return { success: true };
}
