import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpensePaymentMethodStatus = "active" | "archived";

const EXPENSE_PAYMENT_METHOD_SELECT = "id, name, is_default, status, created_at, updated_at";

export interface CreateExpensePaymentMethodInput {
  name: string;
  isDefault: boolean;
  createdBy: string;
}

export interface UpdateExpensePaymentMethodInput {
  name: string;
  isDefault: boolean;
}

export interface ExpensePaymentMethod {
  id: string;
  name: string;
  isDefault: boolean;
  status: ExpensePaymentMethodStatus;
  createdAt: string;
  updatedAt: string;
}

function toExpensePaymentMethod(row: {
  id: string;
  name: string;
  is_default: boolean;
  status: string;
  created_at: string;
  updated_at: string;
}): ExpensePaymentMethod {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    status: row.status as ExpensePaymentMethodStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * ExpensePaymentMethodService — the configured payment-method catalog,
 * identical shape to ExpenseItemService/ExpenseCategoryService. `create`/
 * `update` never set is_default=true directly for a second row -- use
 * setDefault(), which unsets any other default first. The real backstop
 * against a race producing two defaults is the partial unique index
 * (idx_expense_payment_methods_one_default, migration 0079), not the
 * unset-then-set ordering here -- that ordering is purely for a clean UX
 * (avoid a spurious constraint-violation error on the common path).
 */
export class ExpensePaymentMethodService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listActive(tenantId: string): Promise<ExpensePaymentMethod[]> {
    const { data, error } = await this.supabase
      .from("expense_payment_methods")
      .select(EXPENSE_PAYMENT_METHOD_SELECT)
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`ExpensePaymentMethodService.listActive: ${error.message}`);
    }
    return (data ?? []).map(toExpensePaymentMethod);
  }

  async listAll(tenantId: string): Promise<ExpensePaymentMethod[]> {
    const { data, error } = await this.supabase
      .from("expense_payment_methods")
      .select(EXPENSE_PAYMENT_METHOD_SELECT)
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });

    if (error) {
      throw new Error(`ExpensePaymentMethodService.listAll: ${error.message}`);
    }
    return (data ?? []).map(toExpensePaymentMethod);
  }

  async create(tenantId: string, input: CreateExpensePaymentMethodInput): Promise<ExpensePaymentMethod> {
    if (input.isDefault) {
      await this.clearDefault(tenantId);
    }
    const { data, error } = await this.supabase
      .from("expense_payment_methods")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        is_default: input.isDefault,
        created_by: input.createdBy,
      })
      .select(EXPENSE_PAYMENT_METHOD_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpensePaymentMethodService.create: ${error?.message ?? "no row returned"}`);
    }
    return toExpensePaymentMethod(data);
  }

  async update(tenantId: string, id: string, input: UpdateExpensePaymentMethodInput): Promise<ExpensePaymentMethod> {
    if (input.isDefault) {
      await this.clearDefault(tenantId, id);
    }
    const { data, error } = await this.supabase
      .from("expense_payment_methods")
      .update({
        name: input.name,
        is_default: input.isDefault,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select(EXPENSE_PAYMENT_METHOD_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpensePaymentMethodService.update: ${error?.message ?? "no row returned"}`);
    }
    return toExpensePaymentMethod(data);
  }

  async setDefault(tenantId: string, id: string): Promise<void> {
    await this.clearDefault(tenantId, id);
    const { error } = await this.supabase
      .from("expense_payment_methods")
      .update({ is_default: true, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) {
      throw new Error(`ExpensePaymentMethodService.setDefault: ${error.message}`);
    }
  }

  /** Unsets is_default on every other active row for the tenant -- `excludeId` skips the row about to become the new default, if any. */
  private async clearDefault(tenantId: string, excludeId?: string): Promise<void> {
    let query = this.supabase
      .from("expense_payment_methods")
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("is_default", true);

    if (excludeId) {
      query = query.neq("id", excludeId);
    }

    const { error } = await query;
    if (error) {
      throw new Error(`ExpensePaymentMethodService.clearDefault: ${error.message}`);
    }
  }

  async archive(tenantId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_payment_methods")
      .update({ status: "archived", is_default: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) {
      throw new Error(`ExpensePaymentMethodService.archive: ${error.message}`);
    }
  }

  async reactivate(tenantId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_payment_methods")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id);

    if (error) {
      throw new Error(`ExpensePaymentMethodService.reactivate: ${error.message}`);
    }
  }
}
