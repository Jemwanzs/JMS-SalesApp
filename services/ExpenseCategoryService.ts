import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpenseCategoryStatus = "active" | "archived";

const EXPENSE_CATEGORY_SELECT = "id, name, receipt_required, status, created_at, updated_at";

export interface CreateExpenseCategoryInput {
  name: string;
  receiptRequired: boolean;
  createdBy: string;
}

export interface UpdateExpenseCategoryInput {
  name: string;
  receiptRequired: boolean;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  receiptRequired: boolean;
  status: ExpenseCategoryStatus;
  createdAt: string;
  updatedAt: string;
}

function toExpenseCategory(row: {
  id: string;
  name: string;
  receipt_required: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}): ExpenseCategory {
  return {
    id: row.id,
    name: row.name,
    receiptRequired: row.receipt_required,
    status: row.status as ExpenseCategoryStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * ExpenseCategoryService — the configured expense-category catalog,
 * identical shape to ExpenseItemService: plain RLS-gated CRUD, archived
 * (never hard-deleted) so a later-archived category's name still
 * resolves for old expense records that reference it via
 * expenses.category_id/category_name_snapshot. See migration
 * 0079_expense_categories_and_payment_methods.sql.
 */
export class ExpenseCategoryService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listActive(tenantId: string): Promise<ExpenseCategory[]> {
    const { data, error } = await this.supabase
      .from("expense_categories")
      .select(EXPENSE_CATEGORY_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`ExpenseCategoryService.listActive: ${error.message}`);
    }
    return (data ?? []).map(toExpenseCategory);
  }

  /** Active + archived, for the config tab -- archived categories still show, tagged, so an admin can reactivate one. */
  async listAll(tenantId: string): Promise<ExpenseCategory[]> {
    const { data, error } = await this.supabase
      .from("expense_categories")
      .select(EXPENSE_CATEGORY_SELECT)
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`ExpenseCategoryService.listAll: ${error.message}`);
    }
    return (data ?? []).map(toExpenseCategory);
  }

  async create(tenantId: string, input: CreateExpenseCategoryInput): Promise<ExpenseCategory> {
    const { data, error } = await this.supabase
      .from("expense_categories")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        receipt_required: input.receiptRequired,
        created_by: input.createdBy,
      })
      .select(EXPENSE_CATEGORY_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseCategoryService.create: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseCategory(data);
  }

  async update(tenantId: string, categoryId: string, input: UpdateExpenseCategoryInput): Promise<ExpenseCategory> {
    const { data, error } = await this.supabase
      .from("expense_categories")
      .update({
        name: input.name,
        receipt_required: input.receiptRequired,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", categoryId)
      .select(EXPENSE_CATEGORY_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseCategoryService.update: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseCategory(data);
  }

  async archive(tenantId: string, categoryId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_categories")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", categoryId);

    if (error) {
      throw new Error(`ExpenseCategoryService.archive: ${error.message}`);
    }
  }

  async reactivate(tenantId: string, categoryId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_categories")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", categoryId);

    if (error) {
      throw new Error(`ExpenseCategoryService.reactivate: ${error.message}`);
    }
  }
}
