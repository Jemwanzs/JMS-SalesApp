"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseBudgetService } from "@/services/ExpenseBudgetService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ArchiveExpenseBudgetState {
  error?: string;
  success?: boolean;
}

/** Toggles active <-> archived -- same "one action covers both directions" convention as setExpenseCategoryStatusAction. */
export async function setExpenseBudgetStatusAction(
  tenantId: string,
  tenantSlug: string,
  budgetId: string,
  nextStatus: "active" | "archived"
): Promise<ArchiveExpenseBudgetState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.manage_budgets", { tenantId });

    const service = new ExpenseBudgetService(supabase);
    if (nextStatus === "archived") {
      await service.archive(tenantId, budgetId);
    } else {
      await service.reactivate(tenantId, budgetId);
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_BUDGET_ARCHIVED,
        entityType: "expense_budgets",
        entityId: budgetId,
        newValues: { status: nextStatus },
      })
      .catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not update this budget";
    return { error: message.includes("idx_expense_budgets_one_active") ? "This branch already has an active budget for this category" : message };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  revalidatePath(`/t/${tenantSlug}/expenses`);
  return { success: true };
}
