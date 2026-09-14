"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseRecurringTemplateService } from "@/services/ExpenseRecurringTemplateService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ArchiveExpenseRecurringTemplateState {
  error?: string;
  success?: boolean;
}

/** Toggles active <-> archived -- same "one action covers both directions" convention as setExpenseBudgetStatusAction. Archiving simply stops the daily sweep from ever matching this template again; already-generated expenses are untouched. */
export async function setExpenseRecurringTemplateStatusAction(
  tenantId: string,
  tenantSlug: string,
  templateId: string,
  nextStatus: "active" | "archived"
): Promise<ArchiveExpenseRecurringTemplateState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.manage_recurring", { tenantId });

    const service = new ExpenseRecurringTemplateService(supabase);
    if (nextStatus === "archived") {
      await service.archive(tenantId, templateId);
    } else {
      await service.reactivate(tenantId, templateId);
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_RECURRING_TEMPLATE_ARCHIVED,
        entityType: "expense_recurring_templates",
        entityId: templateId,
        newValues: { status: nextStatus },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this recurring expense" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true };
}
