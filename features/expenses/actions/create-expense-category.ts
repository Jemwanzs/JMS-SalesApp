"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseCategoryService, type ExpenseCategory } from "@/services/ExpenseCategoryService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { createExpenseCategorySchema, type CreateExpenseCategoryInput } from "@/validations/expense";

export interface CreateExpenseCategoryState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CreateExpenseCategoryInput, string>>;
  success?: boolean;
  category?: ExpenseCategory;
}

export async function createExpenseCategoryAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: CreateExpenseCategoryState,
  formData: FormData
): Promise<CreateExpenseCategoryState> {
  const parsed = createExpenseCategorySchema.safeParse({
    name: formData.get("name"),
    receiptRequired: formData.get("receiptRequired"),
    requiresApproval: formData.get("requiresApproval"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof CreateExpenseCategoryInput>(parsed.error.issues) };
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

    category = await new ExpenseCategoryService(supabase).create(tenantId, {
      name: parsed.data.name,
      receiptRequired: parsed.data.receiptRequired ?? false,
      requiresApproval: parsed.data.requiresApproval ?? false,
      createdBy: user.id,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_CATEGORY_CREATED,
        entityType: "expense_categories",
        entityId: category.id,
        newValues: { name: category.name, receiptRequired: category.receiptRequired, requiresApproval: category.requiresApproval },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this category" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true, category };
}
