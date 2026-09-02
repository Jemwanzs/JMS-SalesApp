"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseItemService } from "@/services/ExpenseItemService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ArchiveExpenseItemState {
  error?: string;
  success?: boolean;
}

/** Toggles active <-> archived -- reactivating is exactly as common as archiving (an expense item retired by mistake), so one action covers both directions. */
export async function setExpenseItemStatusAction(
  tenantId: string,
  tenantSlug: string,
  expenseItemId: string,
  nextStatus: "active" | "archived"
): Promise<ArchiveExpenseItemState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.configure_items", { tenantId });

    const service = new ExpenseItemService(supabase);
    if (nextStatus === "archived") {
      await service.archive(tenantId, expenseItemId);
    } else {
      await service.reactivate(tenantId, expenseItemId);
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_ITEM_ARCHIVED,
        entityType: "expense_items",
        entityId: expenseItemId,
        newValues: { status: nextStatus },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this expense item" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true };
}
