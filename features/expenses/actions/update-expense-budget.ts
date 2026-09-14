"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseBudgetService, type ExpenseBudget } from "@/services/ExpenseBudgetService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { updateExpenseBudgetSchema, type UpdateExpenseBudgetInput } from "@/validations/expense";

export interface UpdateExpenseBudgetState {
  error?: string;
  fieldErrors?: Partial<Record<keyof UpdateExpenseBudgetInput, string>>;
  success?: boolean;
  budget?: ExpenseBudget;
}

export async function updateExpenseBudgetAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateExpenseBudgetState,
  formData: FormData
): Promise<UpdateExpenseBudgetState> {
  const parsed = updateExpenseBudgetSchema.safeParse({
    budgetId: formData.get("budgetId"),
    locationId: formData.get("locationId"),
    categoryId: formData.get("categoryId"),
    monthlyAmount: formData.get("monthlyAmount"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof UpdateExpenseBudgetInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  let budget: ExpenseBudget;
  try {
    await assertCan("expenses.manage_budgets", { tenantId });

    budget = await new ExpenseBudgetService(supabase).update(tenantId, parsed.data.budgetId, {
      locationId: parsed.data.locationId,
      categoryId: parsed.data.categoryId,
      monthlyAmount: parsed.data.monthlyAmount,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_BUDGET_EDITED,
        entityType: "expense_budgets",
        entityId: budget.id,
        newValues: { locationId: budget.locationId, categoryId: budget.categoryId, monthlyAmount: budget.monthlyAmount },
      })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update this budget";
    return { error: message.includes("idx_expense_budgets_one_active") ? "This branch already has an active budget for this category" : message };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  revalidatePath(`/t/${tenantSlug}/expenses`);
  return { success: true, budget };
}
