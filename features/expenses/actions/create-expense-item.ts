"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ExpenseItemService, type ExpenseItem } from "@/services/ExpenseItemService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { createExpenseItemSchema, type CreateExpenseItemInput } from "@/validations/expense";

export interface CreateExpenseItemState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CreateExpenseItemInput, string>>;
  success?: boolean;
  expenseItem?: ExpenseItem;
}

export async function createExpenseItemAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: CreateExpenseItemState,
  formData: FormData
): Promise<CreateExpenseItemState> {
  const parsed = createExpenseItemSchema.safeParse({
    name: formData.get("name"),
    expenseType: formData.get("expenseType"),
    estimatedAmount: formData.get("estimatedAmount"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof CreateExpenseItemInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  let expenseItem: ExpenseItem;
  try {
    await assertCan("expenses.configure_items", { tenantId });

    expenseItem = await new ExpenseItemService(supabase).create(tenantId, {
      name: parsed.data.name,
      expenseType: parsed.data.expenseType,
      estimatedAmount: parsed.data.estimatedAmount === "" || parsed.data.estimatedAmount == null ? null : Number(parsed.data.estimatedAmount),
      createdBy: user.id,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.EXPENSE_ITEM_CREATED,
        entityType: "expense_items",
        entityId: expenseItem.id,
        newValues: { name: expenseItem.name, expenseType: expenseItem.expenseType, estimatedAmount: expenseItem.estimatedAmount },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this expense item" };
  }

  revalidatePath(`/t/${tenantSlug}/expense-items`);
  return { success: true, expenseItem };
}
