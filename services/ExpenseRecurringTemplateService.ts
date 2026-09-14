import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpenseRecurringTemplateStatus = "active" | "archived";

const EXPENSE_RECURRING_TEMPLATE_SELECT =
  "id, location_id, expense_item_id, category_id, payment_method_id, amount, vendor, reference_number, tax_amount, reimbursable, notes, day_of_month, status, created_by, created_at, updated_at";

export interface RecurringTemplateFields {
  locationId: string;
  expenseItemId: string;
  categoryId: string;
  paymentMethodId: string;
  amount: number;
  vendor?: string | null;
  referenceNumber?: string | null;
  taxAmount?: number | null;
  reimbursable?: boolean;
  notes?: string | null;
  dayOfMonth: number;
}

export interface CreateExpenseRecurringTemplateInput extends RecurringTemplateFields {
  createdBy: string;
}

export type UpdateExpenseRecurringTemplateInput = RecurringTemplateFields;

export interface ExpenseRecurringTemplate {
  id: string;
  locationId: string;
  expenseItemId: string;
  categoryId: string;
  paymentMethodId: string;
  amount: number;
  vendor: string | null;
  referenceNumber: string | null;
  taxAmount: number | null;
  reimbursable: boolean;
  notes: string | null;
  dayOfMonth: number;
  status: ExpenseRecurringTemplateStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function toExpenseRecurringTemplate(row: {
  id: string;
  location_id: string;
  expense_item_id: string;
  category_id: string;
  payment_method_id: string;
  amount: number | string;
  vendor: string | null;
  reference_number: string | null;
  tax_amount: number | string | null;
  reimbursable: boolean;
  notes: string | null;
  day_of_month: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}): ExpenseRecurringTemplate {
  return {
    id: row.id,
    locationId: row.location_id,
    expenseItemId: row.expense_item_id,
    categoryId: row.category_id,
    paymentMethodId: row.payment_method_id,
    amount: Number(row.amount),
    vendor: row.vendor,
    referenceNumber: row.reference_number,
    taxAmount: row.tax_amount === null ? null : Number(row.tax_amount),
    reimbursable: row.reimbursable,
    notes: row.notes,
    dayOfMonth: row.day_of_month,
    status: row.status as ExpenseRecurringTemplateStatus,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * ExpenseRecurringTemplateService — plain RLS-gated CRUD over the
 * templates a daily pg_cron sweep (generate_due_recurring_expenses(),
 * migration 0088) reads to auto-generate real `expenses` rows on their
 * configured day of month. This service never generates an expense
 * itself -- that only ever happens server-side via the sweep, so an
 * `expenses.manage_recurring` holder editing a template can't
 * accidentally (or deliberately) backdate/duplicate a generation by
 * calling something client-reachable.
 */
export class ExpenseRecurringTemplateService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /** For the management tab -- every branch, active + archived. */
  async listAll(tenantId: string): Promise<ExpenseRecurringTemplate[]> {
    const { data, error } = await this.supabase
      .from("expense_recurring_templates")
      .select(EXPENSE_RECURRING_TEMPLATE_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`ExpenseRecurringTemplateService.listAll: ${error.message}`);
    }
    return (data ?? []).map(toExpenseRecurringTemplate);
  }

  async create(tenantId: string, input: CreateExpenseRecurringTemplateInput): Promise<ExpenseRecurringTemplate> {
    const { data, error } = await this.supabase
      .from("expense_recurring_templates")
      .insert({
        tenant_id: tenantId,
        location_id: input.locationId,
        expense_item_id: input.expenseItemId,
        category_id: input.categoryId,
        payment_method_id: input.paymentMethodId,
        amount: input.amount,
        vendor: input.vendor ?? null,
        reference_number: input.referenceNumber ?? null,
        tax_amount: input.taxAmount ?? null,
        reimbursable: input.reimbursable ?? false,
        notes: input.notes ?? null,
        day_of_month: input.dayOfMonth,
        created_by: input.createdBy,
      })
      .select(EXPENSE_RECURRING_TEMPLATE_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseRecurringTemplateService.create: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseRecurringTemplate(data);
  }

  async update(tenantId: string, templateId: string, input: UpdateExpenseRecurringTemplateInput): Promise<ExpenseRecurringTemplate> {
    const { data, error } = await this.supabase
      .from("expense_recurring_templates")
      .update({
        location_id: input.locationId,
        expense_item_id: input.expenseItemId,
        category_id: input.categoryId,
        payment_method_id: input.paymentMethodId,
        amount: input.amount,
        vendor: input.vendor ?? null,
        reference_number: input.referenceNumber ?? null,
        tax_amount: input.taxAmount ?? null,
        reimbursable: input.reimbursable ?? false,
        notes: input.notes ?? null,
        day_of_month: input.dayOfMonth,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("id", templateId)
      .select(EXPENSE_RECURRING_TEMPLATE_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`ExpenseRecurringTemplateService.update: ${error?.message ?? "no row returned"}`);
    }
    return toExpenseRecurringTemplate(data);
  }

  async archive(tenantId: string, templateId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_recurring_templates")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", templateId);

    if (error) {
      throw new Error(`ExpenseRecurringTemplateService.archive: ${error.message}`);
    }
  }

  async reactivate(tenantId: string, templateId: string): Promise<void> {
    const { error } = await this.supabase
      .from("expense_recurring_templates")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", templateId);

    if (error) {
      throw new Error(`ExpenseRecurringTemplateService.reactivate: ${error.message}`);
    }
  }
}
