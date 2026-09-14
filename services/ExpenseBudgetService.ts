import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpenseBudgetStatus = "active" | "archived";

const EXPENSE_BUDGET_SELECT = "id, location_id, category_id, monthly_amount, status, created_at, updated_at";

export interface CreateExpenseBudgetInput {
  locationId: string;
  categoryId: string;
  monthlyAmount: number;
  createdBy: string;
}

export interface UpdateExpenseBudgetInput {
  locationId: string;
  categoryId: string;
  monthlyAmount: number;
}

export interface ExpenseBudget {
  id: string;
  locationId: string;
  categoryId: string;
  monthlyAmount: number;
  status: ExpenseBudgetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseBudgetStatusEntry {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  monthlyAmount: number;
  spent: number;
  remaining: number;
  percentUsed: number;
}

function toExpenseBudget(row: {
  id: string;
  location_id: string;
  category_id: string;
  monthly_amount: number | string;
  status: string;
  created_at: string;
  updated_at: string;
}): ExpenseBudget {
  return {
    id: row.id,
    locationId: row.location_id,
    categoryId: row.category_id,
    monthlyAmount: Number(row.monthly_amount),
    status: row.status as ExpenseBudgetStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * ExpenseBudgetService — a monthly spend cap per (branch, category).
 * Plain RLS-gated CRUD, same shape as ExpenseCategoryService (archived,
 * never hard-deleted). Purely advisory: nothing here ever blocks
 * recording an over-budget expense (see migration 0087's own header
 * comment) -- getBudgetStatus just computes how close each active budget
 * is to its cap by re-aggregating the expenses ledger in application
 * code, same "fetch raw rows, aggregate in JS" convention
 * ExpenseService.getBreakdown/getDashboardSummary already document for
 * themselves.
 */
export class ExpenseBudgetService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /** For the management tab -- every branch, active + archived. */
  async listAll(tenantId: string): Promise<ExpenseBudget[]> {
    const { data, error } = await this.supabase
      .from("expense_budgets")
      .select(EXPENSE_BUDGET_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`ExpenseBudgetService.listAll: ${error.message}`);
    }
    return (data ?? []).map(toExpenseBudget);
  }

  async create(tenantId: string, input: CreateExpenseBudgetInput): Promise<ExpenseBudget> {
    const { data, error } = await this.supabase
      .from("expense_budgets")
      .insert({
        tenant_id: tenantId,
        location_id: input.locationId,
        category_id: input.categoryId,
        monthly_amount: input.monthlyAmount,
        created_by: input.createdBy,
      })
      .select(EXPENSE_BUDGET_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseBudgetService.create: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseBudget(data);
  }

  async update(tenantId: string, budgetId: string, input: UpdateExpenseBudgetInput): Promise<ExpenseBudget> {
    const { data, error } = await this.supabase
      .from("expense_budgets")
      .update({
        location_id: input.locationId,
        category_id: input.categoryId,
        monthly_amount: input.monthlyAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", budgetId)
      .select(EXPENSE_BUDGET_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseBudgetService.update: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseBudget(data);
  }

  async archive(tenantId: string, budgetId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_budgets")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", budgetId);

    if (error) {
      throw new Error(`ExpenseBudgetService.archive: ${error.message}`);
    }
  }

  async reactivate(tenantId: string, budgetId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_budgets")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", budgetId);

    if (error) {
      throw new Error(`ExpenseBudgetService.reactivate: ${error.message}`);
    }
  }

  /**
   * Active budgets for one branch, each compared against that category's
   * 'active'-status spend so far this month at that same branch. Not
   * paginated/limited -- a tenant realistically has a handful of budgets
   * per branch, never hundreds.
   */
  async getBudgetStatus(
    tenantId: string,
    locationId: string,
    monthStart: string,
    today: string
  ): Promise<ExpenseBudgetStatusEntry[]> {
    const { data: budgets, error: budgetsError } = await this.supabase
      .from("expense_budgets")
      .select("id, category_id, monthly_amount")
      .eq("tenant_id", tenantId)
      .eq("location_id", locationId)
      .eq("status", "active");

    if (budgetsError) {
      throw new Error(`ExpenseBudgetService.getBudgetStatus: ${budgetsError.message}`);
    }
    if (!budgets || budgets.length === 0) return [];

    const categoryIds = budgets.map((b) => b.category_id);

    // Two follow-up queries (category names, this-month spend) rather
    // than an embedded relational select -- same "resolve names in a
    // batched follow-up query" convention ExpenseService.getBreakdown
    // already uses for branch/recordedBy labels.
    const { data: categoryRows } = await this.supabase.from("expense_categories").select("id, name").in("id", categoryIds);
    const categoryNameById = new Map((categoryRows ?? []).map((c) => [c.id, c.name]));

    const { data: expenses, error: expensesError } = await this.supabase
      .from("expenses")
      .select("category_id, actual_amount")
      .eq("tenant_id", tenantId)
      .eq("location_id", locationId)
      .eq("status", "active")
      .gte("expense_date", monthStart)
      .lte("expense_date", today)
      .in("category_id", categoryIds);

    if (expensesError) {
      throw new Error(`ExpenseBudgetService.getBudgetStatus: ${expensesError.message}`);
    }

    const spentByCategory = new Map<string, number>();
    for (const row of expenses ?? []) {
      if (!row.category_id) continue;
      spentByCategory.set(row.category_id, (spentByCategory.get(row.category_id) ?? 0) + Number(row.actual_amount));
    }

    return budgets
      .map((b) => {
        const monthlyAmount = Number(b.monthly_amount);
        const spent = spentByCategory.get(b.category_id) ?? 0;
        return {
          budgetId: b.id,
          categoryId: b.category_id,
          categoryName: categoryNameById.get(b.category_id) ?? "Unknown category",
          monthlyAmount,
          spent,
          remaining: monthlyAmount - spent,
          percentUsed: monthlyAmount > 0 ? (spent / monthlyAmount) * 100 : 0,
        };
      })
      .sort((a, b) => b.percentUsed - a.percentUsed);
  }
}
