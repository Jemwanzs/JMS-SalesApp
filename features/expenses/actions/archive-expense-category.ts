"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseCategoryService } from "@/services/ExpenseCategoryService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ArchiveExpenseCategoryState {
  error?: string;
  success?: boolean;
}

/** Toggles active <-> archived -- same "one action covers both directions" convention as setExpenseItemStatusAction. */
export async function setExpenseCategoryStatusAction(
  tenantId: string,
  tenantSlug: string,
  categoryId: string,
  nextStatus: "active" | "archived"
): Promise<ArchiveExpenseCategoryState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.manage_categories", { tenantId });

    const service = new ExpenseCategoryService(supabase);
    if (nextStatus === "archived") {
      await service.archive(tenantId, categoryId);
    } else {
      await service.reactivate(tenantId, categoryId);
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_CATEGORY_ARCHIVED,
        entityType: "expense_categories",
        entityId: categoryId,
        newValues: { status: nextStatus },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this category" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true };
}
