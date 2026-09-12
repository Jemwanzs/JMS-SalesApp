"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseCategoryService, type ExpenseCategory } from "@/services/ExpenseCategoryService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { updateExpenseCategorySchema, type UpdateExpenseCategoryInput } from "@/validations/expense";

export interface UpdateExpenseCategoryState {
  error?: string;
  fieldErrors?: Partial<Record<keyof UpdateExpenseCategoryInput, string>>;
  success?: boolean;
  category?: ExpenseCategory;
}

export async function updateExpenseCategoryAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateExpenseCategoryState,
  formData: FormData
): Promise<UpdateExpenseCategoryState> {
  const parsed = updateExpenseCategorySchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    receiptRequired: formData.get("receiptRequired"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof UpdateExpenseCategoryInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  let category: ExpenseCategory;
  try {
    await assertCan("expenses.manage_categories", { tenantId });

    category = await new ExpenseCategoryService(supabase).update(tenantId, parsed.data.categoryId, {
      name: parsed.data.name,
      receiptRequired: parsed.data.receiptRequired ?? false,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_CATEGORY_EDITED,
        entityType: "expense_categories",
        entityId: category.id,
        newValues: { name: category.name, receiptRequired: category.receiptRequired },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this category" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true, category };
}
