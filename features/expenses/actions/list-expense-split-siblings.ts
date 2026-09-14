"use server";

import { ExpenseService, type ExpenseRecord } from "@/services/ExpenseService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface ListExpenseSplitSiblingsState {
  error?: string;
  siblings?: ExpenseRecord[];
}

export async function listExpenseSplitSiblingsAction(
  tenantId: string,
  splitGroupId: string,
  excludeExpenseId: string
): Promise<ListExpenseSplitSiblingsState> {
  try {
    await assertCan("expenses.view", { tenantId });
    const supabase = await createClient();
    const siblings = await new ExpenseService(supabase).getSplitSiblings(tenantId, splitGroupId, excludeExpenseId);
    return { siblings };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load the other splits" };
  }
}
