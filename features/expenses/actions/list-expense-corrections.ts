"use server";

import { ExpenseService, type ExpenseCorrection } from "@/services/ExpenseService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface ListExpenseCorrectionsState {
  error?: string;
  corrections?: ExpenseCorrection[];
}

export async function listExpenseCorrectionsAction(tenantId: string, expenseId: string): Promise<ListExpenseCorrectionsState> {
  try {
    await assertCan("expenses.view", { tenantId });
    const supabase = await createClient();
    const corrections = await new ExpenseService(supabase).listCorrections(tenantId, expenseId);
    return { corrections };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not load correction history" };
  }
}
