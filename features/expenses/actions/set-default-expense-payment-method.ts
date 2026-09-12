"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpensePaymentMethodService } from "@/services/ExpensePaymentMethodService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetDefaultExpensePaymentMethodState {
  error?: string;
  success?: boolean;
}

export async function setDefaultExpensePaymentMethodAction(
  tenantId: string,
  tenantSlug: string,
  paymentMethodId: string
): Promise<SetDefaultExpensePaymentMethodState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.manage_payment_methods", { tenantId });

    await new ExpensePaymentMethodService(supabase).setDefault(tenantId, paymentMethodId);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_PAYMENT_METHOD_EDITED,
        entityType: "expense_payment_methods",
        entityId: paymentMethodId,
        newValues: { isDefault: true },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not set this payment method as default" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true };
}
