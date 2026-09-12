"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpensePaymentMethodService } from "@/services/ExpensePaymentMethodService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ArchiveExpensePaymentMethodState {
  error?: string;
  success?: boolean;
}

/** Toggles active <-> archived. Archiving the current default also clears is_default (ExpensePaymentMethodService.archive) -- an archived method can never stay the default new expenses fall back to. */
export async function setExpensePaymentMethodStatusAction(
  tenantId: string,
  tenantSlug: string,
  paymentMethodId: string,
  nextStatus: "active" | "archived"
): Promise<ArchiveExpensePaymentMethodState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.manage_payment_methods", { tenantId });

    const service = new ExpensePaymentMethodService(supabase);
    if (nextStatus === "archived") {
      await service.archive(tenantId, paymentMethodId);
    } else {
      await service.reactivate(tenantId, paymentMethodId);
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_PAYMENT_METHOD_ARCHIVED,
        entityType: "expense_payment_methods",
        entityId: paymentMethodId,
        newValues: { status: nextStatus },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this payment method" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true };
}
