"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpensePaymentMethodService, type ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { updateExpensePaymentMethodSchema, type UpdateExpensePaymentMethodInput } from "@/validations/expense";

export interface UpdateExpensePaymentMethodState {
  error?: string;
  fieldErrors?: Partial<Record<keyof UpdateExpensePaymentMethodInput, string>>;
  success?: boolean;
  paymentMethod?: ExpensePaymentMethod;
}

export async function updateExpensePaymentMethodAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateExpensePaymentMethodState,
  formData: FormData
): Promise<UpdateExpensePaymentMethodState> {
  const parsed = updateExpensePaymentMethodSchema.safeParse({
    paymentMethodId: formData.get("paymentMethodId"),
    name: formData.get("name"),
    isDefault: formData.get("isDefault"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof UpdateExpensePaymentMethodInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  let paymentMethod: ExpensePaymentMethod;
  try {
    await assertCan("expenses.manage_payment_methods", { tenantId });

    paymentMethod = await new ExpensePaymentMethodService(supabase).update(tenantId, parsed.data.paymentMethodId, {
      name: parsed.data.name,
      isDefault: parsed.data.isDefault ?? false,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_PAYMENT_METHOD_EDITED,
        entityType: "expense_payment_methods",
        entityId: paymentMethod.id,
        newValues: { name: paymentMethod.name, isDefault: paymentMethod.isDefault },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this payment method" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true, paymentMethod };
}
