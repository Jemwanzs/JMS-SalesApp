import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpenseItemType = "recurring" | "one_time";
export type ExpenseItemStatus = "active" | "archived";

const EXPENSE_ITEM_SELECT = "id, name, expense_type, estimated_amount, category_id, status, created_at, updated_at";

export interface CreateExpenseItemInput {
  name: string;
  expenseType: ExpenseItemType;
  estimatedAmount?: number | null;
  categoryId?: string | null;
  createdBy: string;
}

export interface UpdateExpenseItemInput {
  name: string;
  expenseType: ExpenseItemType;
  estimatedAmount?: number | null;
  categoryId?: string | null;
}

export interface ExpenseItem {
  id: string;
  name: string;
  expenseType: ExpenseItemType;
  estimatedAmount: number | null;
  categoryId: string | null;
  status: ExpenseItemStatus;
  createdAt: string;
  updatedAt: string;
}

function toExpenseItem(row: {
  id: string;
  name: string;
  expense_type: string;
  estimated_amount: number | string | null;
  category_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}): ExpenseItem {
  return {
    id: row.id,
    name: row.name,
    expenseType: row.expense_type as ExpenseItemType,
    estimatedAmount: row.estimated_amount === null ? null : Number(row.estimated_amount),
    categoryId: row.category_id,
    status: row.status as ExpenseItemStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * ExpenseItemService — the configured Expense Items catalog (Water,
 * Electricity, Rent, ...), closer to ProductService than to a ledger:
 * plain RLS-gated CRUD, archived (never hard-deleted, same reasoning
 * products never are) so a later-archived item's name/type still
 * resolves for old expense records that reference it. See migration
 * 0054_daily_expenses.sql's header comment for the full feature design.
 */
export class ExpenseItemService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listActive(tenantId: string): Promise<ExpenseItem[]> {
    const { data, error } = await this.supabase
      .from("expense_items")
      .select(EXPENSE_ITEM_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`ExpenseItemService.listActive: ${error.message}`);
    }
    return (data ?? []).map(toExpenseItem);
  }

  /** Active + archived, for the config page -- archived items still show, tagged, so an admin can reactivate one. */
  async listAll(tenantId: string): Promise<ExpenseItem[]> {
    const { data, error } = await this.supabase
      .from("expense_items")
      .select(EXPENSE_ITEM_SELECT)
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`ExpenseItemService.listAll: ${error.message}`);
    }
    return (data ?? []).map(toExpenseItem);
  }

  async create(tenantId: string, input: CreateExpenseItemInput): Promise<ExpenseItem> {
    const { data, error } = await this.supabase
      .from("expense_items")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        expense_type: input.expenseType,
        estimated_amount: input.estimatedAmount ?? null,
        category_id: input.categoryId ?? null,
        created_by: input.createdBy,
      })
      .select(EXPENSE_ITEM_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseItemService.create: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseItem(data);
  }

  /** Every field stays editable after creation, per spec -- a full replace, same convention ProductService.update already follows. */
  async update(tenantId: string, expenseItemId: string, input: UpdateExpenseItemInput): Promise<ExpenseItem> {
    const { data, error } = await this.supabase
      .from("expense_items")
      .update({
        name: input.name,
        expense_type: input.expenseType,
        estimated_amount: input.estimatedAmount ?? null,
        category_id: input.categoryId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", expenseItemId)
      .select(EXPENSE_ITEM_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseItemService.update: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseItem(data);
  }

  /**
   * Distinct expense_item_ids ordered by most-recent use (their latest
   * expenses.created_at), backing the combobox's "recently used first"
   * sort (spec requirement). Reads raw ids off idx_expenses_tenant_date's
   * leading columns -- the caller joins these ids against listActive()'s
   * own result rather than this method duplicating item fields.
   */
  async listRecentlyUsedIds(tenantId: string, locationId?: string, limit = 10): Promise<string[]> {
    let query = this.supabase
      .from("expenses")
      .select("expense_item_id, created_at")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(200);

    if (locationId) {
      query = query.eq("location_id", locationId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`ExpenseItemService.listRecentlyUsedIds: ${error.message}`);
    }

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of data ?? []) {
      if (!seen.has(row.expense_item_id)) {
        seen.add(row.expense_item_id);
        ordered.push(row.expense_item_id);
      }
      if (ordered.length >= limit) break;
    }
    return ordered;
  }

  async archive(tenantId: string, expenseItemId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_items")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", expenseItemId);

    if (error) {
      throw new Error(`ExpenseItemService.archive: ${error.message}`);
    }
  }

  async reactivate(tenantId: string, expenseItemId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_items")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", expenseItemId);

    if (error) {
      throw new Error(`ExpenseItemService.reactivate: ${error.message}`);
    }
  }
}
