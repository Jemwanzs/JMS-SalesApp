import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpenseStatus = "active" | "voided";

const EXPENSE_SELECT =
  "id, expense_item_id, expense_item_name_snapshot, actual_amount, expense_date, notes, status, recorded_by, voided_by, voided_at, void_reason, edited_by, edited_at, created_at";

export interface RecordExpenseInput {
  locationId: string;
  expenseItemId: string;
  actualAmount: number;
  expenseDate: string;
  notes?: string | null;
  recordedBy: string;
}

export interface ExpenseRecord {
  id: string;
  expenseItemId: string;
  expenseItemName: string;
  actualAmount: number;
  expenseDate: string;
  notes: string | null;
  status: ExpenseStatus;
  recordedBy: string;
  recordedByName: string | null;
  voidedBy: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  editedBy: string | null;
  editedAt: string | null;
  createdAt: string;
}

export interface ExpenseSummaryItem {
  expenseItemId: string;
  expenseItemName: string;
  total: number;
  count: number;
  estimatedAmount: number | null;
}

export interface ExpenseSummary {
  date: string;
  totalAmount: number;
  count: number;
  byItem: ExpenseSummaryItem[];
  highestItem: ExpenseSummaryItem | null;
  highestItemShare: number | null;
}

function toExpenseRecord(row: {
  id: string;
  expense_item_id: string;
  expense_item_name_snapshot: string;
  actual_amount: number | string;
  expense_date: string;
  notes: string | null;
  status: string;
  recorded_by: string;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
  edited_by: string | null;
  edited_at: string | null;
  created_at: string;
}): Omit<ExpenseRecord, "recordedByName"> {
  return {
    id: row.id,
    expenseItemId: row.expense_item_id,
    expenseItemName: row.expense_item_name_snapshot,
    actualAmount: Number(row.actual_amount),
    expenseDate: row.expense_date,
    notes: row.notes,
    status: row.status as ExpenseStatus,
    recordedBy: row.recorded_by,
    voidedBy: row.voided_by,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    editedBy: row.edited_by,
    editedAt: row.edited_at,
    createdAt: row.created_at,
  };
}

/**
 * ExpenseService — the actual recorded-expense ledger, closer to
 * SalesService/StockService than to ExpenseItemService: recordExpense
 * is a direct insert (RLS-gated on expenses.create, same shape as
 * sales_insert/StockService.recordMovement — no RPC needed for the
 * initial write, only for mutating an existing row). editExpense/
 * voidExpense call the edit_expense()/void_expense() SECURITY DEFINER
 * functions (migration 0054), mirroring StockService.submitReconciliation's
 * own RPC-wrapper shape. See that migration's header comment for the
 * full design, including why this stays deliberately simpler than
 * sales' reverse_sale() (no approval-workflow branch).
 */
export class ExpenseService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async recordExpense(tenantId: string, input: RecordExpenseInput): Promise<ExpenseRecord> {
    if (input.actualAmount <= 0) {
      throw new Error("ExpenseService.recordExpense: actualAmount must be greater than 0");
    }

    const { data: item, error: itemError } = await this.supabase
      .from("expense_items")
      .select("name, status")
      .eq("tenant_id", tenantId)
      .eq("id", input.expenseItemId)
      .single();

    if (itemError || !item) {
      throw new Error(`ExpenseService.recordExpense: ${itemError?.message ?? "expense item not found"}`);
    }
    if (item.status !== "active") {
      throw new Error("This expense item has been archived -- reactivate it before recording an expense against it.");
    }

    const { data, error } = await this.supabase
      .from("expenses")
      .insert({
        tenant_id: tenantId,
        location_id: input.locationId,
        expense_item_id: input.expenseItemId,
        expense_item_name_snapshot: item.name,
        actual_amount: input.actualAmount,
        expense_date: input.expenseDate,
        notes: input.notes ?? null,
        recorded_by: input.recordedBy,
      })
      .select(EXPENSE_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseService.recordExpense: ${error?.message ?? "no row returned"}`);
    }
    return { ...toExpenseRecord(data), recordedByName: null };
  }

  /** Defaults to a single date (today, from the caller) -- matches Sales History's own "defaults to today" precedent. */
  async listExpenses(
    tenantId: string,
    filters: { date?: string; from?: string; to?: string; q?: string } = {}
  ): Promise<ExpenseRecord[]> {
    let query = this.supabase.from("expenses").select(EXPENSE_SELECT).eq("tenant_id", tenantId);

    if (filters.date) {
      query = query.eq("expense_date", filters.date);
    } else if (filters.from || filters.to) {
      if (filters.from) query = query.gte("expense_date", filters.from);
      if (filters.to) query = query.lte("expense_date", filters.to);
    }
    if (filters.q) {
      query = query.ilike("expense_item_name_snapshot", `%${filters.q}%`);
    }

    const { data, error } = await query.order("expense_date", { ascending: false }).order("created_at", { ascending: false });

    if (error) {
      throw new Error(`ExpenseService.listExpenses: ${error.message}`);
    }
    if (!data || data.length === 0) return [];

    const recordedByIds = [...new Set(data.map((r) => r.recorded_by))];
    const { data: profiles } = await this.supabase.from("profiles").select("id, full_name").in("id", recordedByIds);
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

    return data.map((row) => ({ ...toExpenseRecord(row), recordedByName: nameById.get(row.recorded_by) ?? null }));
  }

  async editExpense(input: { expenseId: string; actualAmount: number; expenseDate: string; notes?: string | null }): Promise<void> {
    const { error } = await this.supabase.rpc("edit_expense", {
      p_expense_id: input.expenseId,
      p_actual_amount: input.actualAmount,
      p_expense_date: input.expenseDate,
      p_notes: input.notes ?? null,
    });

    if (error) {
      throw new Error(`ExpenseService.editExpense: ${error.message}`);
    }
  }

  async voidExpense(expenseId: string, reason: string): Promise<void> {
    const { error } = await this.supabase.rpc("void_expense", {
      p_expense_id: expenseId,
      p_reason: reason,
    });

    if (error) {
      throw new Error(`ExpenseService.voidExpense: ${error.message}`);
    }
  }

  /**
   * Today/Yesterday/a specific past date only -- no date range (spec:
   * "Do not add a date-range selector for now"). Computed from one
   * query, aggregated in application code -- same "fetch raw rows, join/
   * group in application code" convention AnalyticsService/
   * PlatformAdminService already document for themselves.
   */
  async getSummary(tenantId: string, date: string): Promise<ExpenseSummary> {
    const { data, error } = await this.supabase
      .from("expenses")
      .select("expense_item_id, expense_item_name_snapshot, actual_amount")
      .eq("tenant_id", tenantId)
      .eq("expense_date", date)
      .eq("status", "active");

    if (error) {
      throw new Error(`ExpenseService.getSummary: ${error.message}`);
    }

    const rows = data ?? [];
    const byItemMap = new Map<string, ExpenseSummaryItem>();
    let totalAmount = 0;
    for (const row of rows) {
      const amount = Number(row.actual_amount);
      totalAmount += amount;
      const existing = byItemMap.get(row.expense_item_id);
      if (existing) {
        existing.total += amount;
        existing.count += 1;
      } else {
        byItemMap.set(row.expense_item_id, {
          expenseItemId: row.expense_item_id,
          expenseItemName: row.expense_item_name_snapshot,
          total: amount,
          count: 1,
          estimatedAmount: null,
        });
      }
    }

    const byItem = [...byItemMap.values()].sort((a, b) => b.total - a.total);

    // Estimated amounts are attached from the CURRENT item config (a
    // guide, never enforced) -- best-effort, missing/archived items just
    // show no estimate rather than blocking the summary.
    if (byItem.length > 0) {
      const { data: items } = await this.supabase
        .from("expense_items")
        .select("id, estimated_amount")
        .eq("tenant_id", tenantId)
        .in(
          "id",
          byItem.map((i) => i.expenseItemId)
        );
      const estimateById = new Map((items ?? []).map((i) => [i.id, i.estimated_amount === null ? null : Number(i.estimated_amount)]));
      for (const item of byItem) {
        item.estimatedAmount = estimateById.get(item.expenseItemId) ?? null;
      }
    }

    const highestItem = byItem[0] ?? null;
    const highestItemShare = highestItem && totalAmount > 0 ? highestItem.total / totalAmount : null;

    return {
      date,
      totalAmount,
      count: rows.length,
      byItem,
      highestItem,
      highestItemShare,
    };
  }
}
