"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseRecurringTemplateService, type ExpenseRecurringTemplate } from "@/services/ExpenseRecurringTemplateService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { createExpenseRecurringTemplateSchema, type CreateExpenseRecurringTemplateInput } from "@/validations/expense";

export interface CreateExpenseRecurringTemplateState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CreateExpenseRecurringTemplateInput, string>>;
  success?: boolean;
  template?: ExpenseRecurringTemplate;
}

export async function createExpenseRecurringTemplateAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: CreateExpenseRecurringTemplateState,
  formData: FormData
): Promise<CreateExpenseRecurringTemplateState> {
  const parsed = createExpenseRecurringTemplateSchema.safeParse({
    locationId: formData.get("locationId"),
    expenseItemId: formData.get("expenseItemId"),
    categoryId: formData.get("categoryId"),
    paymentMethodId: formData.get("paymentMethodId"),
    amount: formData.get("amount"),
    dayOfMonth: formData.get("dayOfMonth"),
    vendor: formData.get("vendor") || undefined,
    referenceNumber: formData.get("referenceNumber") || undefined,
    taxAmount: formData.get("taxAmount"),
    reimbursable: formData.get("reimbursable"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof CreateExpenseRecurringTemplateInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  let template: ExpenseRecurringTemplate;
  try {
    await assertCan("expenses.manage_recurring", { tenantId });

    template = await new ExpenseRecurringTemplateService(supabase).create(tenantId, {
      locationId: parsed.data.locationId,
      expenseItemId: parsed.data.expenseItemId,
      categoryId: parsed.data.categoryId,
      paymentMethodId: parsed.data.paymentMethodId,
      amount: parsed.data.amount,
      dayOfMonth: parsed.data.dayOfMonth,
      vendor: parsed.data.vendor || null,
      referenceNumber: parsed.data.referenceNumber || null,
      taxAmount: parsed.data.taxAmount === "" || parsed.data.taxAmount == null ? null : Number(parsed.data.taxAmount),
      reimbursable: parsed.data.reimbursable ?? false,
      notes: parsed.data.notes || null,
      createdBy: user.id,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_RECURRING_TEMPLATE_CREATED,
        entityType: "expense_recurring_templates",
        entityId: template.id,
        newValues: { locationId: template.locationId, categoryId: template.categoryId, amount: template.amount, dayOfMonth: template.dayOfMonth },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this recurring expense" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true, template };
}
