import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpenseItemType = "recurring" | "one_time";
export type ExpenseItemStatus = "active" | "archived";

const EXPENSE_ITEM_SELECT = "id, name, expense_type, estimated_amount, status, created_at, updated_at";

export interface CreateExpenseItemInput {
  name: string;
  expenseType: ExpenseItemType;
  estimatedAmount?: number | null;
  createdBy: string;
}

export interface UpdateExpenseItemInput {
  name: string;
  expenseType: ExpenseItemType;
  estimatedAmount?: number | null;
}

export interface ExpenseItem {
  id: string;
  name: string;
  expenseType: ExpenseItemType;
  estimatedAmount: number | null;
  status: ExpenseItemStatus;
  createdAt: string;
  updatedAt: string;
}

function toExpenseItem(row: {
  id: string;
  name: string;
  expense_type: string;
  estimated_amount: number | string | null;
  status: string;
  created_at: string;
  updated_at: string;
}): ExpenseItem {
  return {
    id: row.id,
    name: row.name,
    expenseType: row.expense_type as ExpenseItemType,
    estimatedAmount: row.estimated_amount === null ? null : Number(row.estimated_amount),
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
