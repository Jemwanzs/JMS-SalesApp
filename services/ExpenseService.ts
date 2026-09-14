import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type ExpenseStatus = "active" | "voided" | "pending_approval" | "rejected";
export type ExpenseReimbursementStatus = "not_applicable" | "pending" | "paid";

export interface ExpenseCorrection {
  id: string;
  correctionType: "void" | "correct";
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown> | null;
  reason: string;
  correctedBy: string;
  correctedByName: string | null;
  correctedAt: string;
}

export interface ExpenseDashboardBranchTotal {
  locationId: string;
  total: number;
  count: number;
}

export interface ExpenseDashboardSummary {
  todayTotal: number;
  thisWeekTotal: number;
  thisMonthTotal: number;
  byBranch: ExpenseDashboardBranchTotal[];
  topCategoryId: string | null;
  topCategoryName: string | null;
  topVendor: string | null;
  withoutReceiptCount: number;
  pendingApprovalCount: number;
  pendingApprovalTotal: number;
  pendingReimbursementCount: number;
  pendingReimbursementTotal: number;
}

export type ExpenseBreakdownDimension = "category" | "vendor" | "paymentMethod" | "branch" | "recordedBy";

export interface ExpenseBreakdownEntry {
  key: string;
  label: string;
  total: number;
  count: number;
}

export interface ExpenseTrendPoint {
  date: string;
  total: number;
}

const EXPENSE_SELECT =
  "id, location_id, expense_item_id, expense_item_name_snapshot, actual_amount, expense_date, notes, status, recorded_by, voided_by, voided_at, void_reason, edited_by, edited_at, created_at, category_id, category_name_snapshot, payment_method_id, payment_method_name_snapshot, vendor, reference_number, tax_amount, reimbursable, receipt_storage_path, receipt_file_type, expense_number, approval_request_id, rejection_reason, reimbursement_status, reimbursed_by, reimbursed_at, reimbursement_reference, reimbursement_notes, recurring_template_id, split_group_id";

export interface RecordSplitExpenseInput {
  locationId: string;
  expenseItemId: string;
  paymentMethodId: string;
  expenseDate: string;
  splits: ExpenseSplitLine[];
  vendor?: string | null;
  referenceNumber?: string | null;
  reimbursable?: boolean;
  receiptStoragePath?: string | null;
  receiptFileType?: string | null;
  notes?: string | null;
  recordedBy: string;
}

export interface RecordExpenseInput {
  /** Client-generated -- lets a receipt upload target `{tenantId}/expenses/{id}/...` in Storage before this row exists. Same trick as ProductService.CreateProductInput.id. */
  id?: string;
  locationId: string;
  expenseItemId: string;
  categoryId: string;
  paymentMethodId: string;
  actualAmount: number;
  expenseDate: string;
  vendor?: string | null;
  referenceNumber?: string | null;
  taxAmount?: number | null;
  reimbursable?: boolean;
  receiptStoragePath?: string | null;
  receiptFileType?: string | null;
  notes?: string | null;
  recordedBy: string;
}

export interface ExpenseRecord {
  id: string;
  expenseNumber: string | null;
  locationId: string;
  expenseItemId: string;
  expenseItemName: string;
  categoryId: string | null;
  categoryName: string | null;
  paymentMethodId: string | null;
  paymentMethodName: string | null;
  vendor: string | null;
  referenceNumber: string | null;
  taxAmount: number | null;
  reimbursable: boolean;
  receiptStoragePath: string | null;
  receiptFileType: string | null;
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
  approvalRequestId: string | null;
  rejectionReason: string | null;
  reimbursementStatus: ExpenseReimbursementStatus;
  reimbursedBy: string | null;
  reimbursedAt: string | null;
  reimbursementReference: string | null;
  reimbursementNotes: string | null;
  recurringTemplateId: string | null;
  splitGroupId: string | null;
}

export interface ExpenseSplitLine {
  categoryId: string;
  amount: number;
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
  location_id: string;
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
  category_id: string | null;
  category_name_snapshot: string | null;
  payment_method_id: string | null;
  payment_method_name_snapshot: string | null;
  vendor: string | null;
  reference_number: string | null;
  tax_amount: number | string | null;
  reimbursable: boolean;
  receipt_storage_path: string | null;
  receipt_file_type: string | null;
  expense_number: string | null;
  approval_request_id: string | null;
  rejection_reason: string | null;
  reimbursement_status: string;
  reimbursed_by: string | null;
  reimbursed_at: string | null;
  reimbursement_reference: string | null;
  reimbursement_notes: string | null;
  recurring_template_id: string | null;
  split_group_id: string | null;
}): Omit<ExpenseRecord, "recordedByName"> {
  return {
    id: row.id,
    expenseNumber: row.expense_number,
    locationId: row.location_id,
    expenseItemId: row.expense_item_id,
    expenseItemName: row.expense_item_name_snapshot,
    categoryId: row.category_id,
    categoryName: row.category_name_snapshot,
    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name_snapshot,
    vendor: row.vendor,
    referenceNumber: row.reference_number,
    taxAmount: row.tax_amount === null ? null : Number(row.tax_amount),
    reimbursable: row.reimbursable,
    receiptStoragePath: row.receipt_storage_path,
    receiptFileType: row.receipt_file_type,
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
    approvalRequestId: row.approval_request_id,
    rejectionReason: row.rejection_reason,
    reimbursementStatus: row.reimbursement_status as ExpenseReimbursementStatus,
    reimbursedBy: row.reimbursed_by,
    reimbursedAt: row.reimbursed_at,
    reimbursementReference: row.reimbursement_reference,
    reimbursementNotes: row.reimbursement_notes,
    recurringTemplateId: row.recurring_template_id,
    splitGroupId: row.split_group_id,
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

    const [{ data: item, error: itemError }, { data: category, error: categoryError }, { data: paymentMethod, error: paymentMethodError }] =
      await Promise.all([
        this.supabase.from("expense_items").select("name, status").eq("tenant_id", tenantId).eq("id", input.expenseItemId).single(),
        this.supabase.from("expense_categories").select("name, status").eq("tenant_id", tenantId).eq("id", input.categoryId).single(),
        this.supabase
          .from("expense_payment_methods")
          .select("name, status")
          .eq("tenant_id", tenantId)
          .eq("id", input.paymentMethodId)
          .single(),
      ]);

    if (itemError || !item) {
      throw new Error(`ExpenseService.recordExpense: ${itemError?.message ?? "expense item not found"}`);
    }
    if (item.status !== "active") {
      throw new Error("This expense item has been archived -- reactivate it before recording an expense against it.");
    }
    if (categoryError || !category) {
      throw new Error(`ExpenseService.recordExpense: ${categoryError?.message ?? "expense category not found"}`);
    }
    if (paymentMethodError || !paymentMethod) {
      throw new Error(`ExpenseService.recordExpense: ${paymentMethodError?.message ?? "payment method not found"}`);
    }

    const { data, error } = await this.supabase
      .from("expenses")
      .insert({
        ...(input.id ? { id: input.id } : {}),
        tenant_id: tenantId,
        location_id: input.locationId,
        expense_item_id: input.expenseItemId,
        expense_item_name_snapshot: item.name,
        category_id: input.categoryId,
        category_name_snapshot: category.name,
        payment_method_id: input.paymentMethodId,
        payment_method_name_snapshot: paymentMethod.name,
        vendor: input.vendor ?? null,
        reference_number: input.referenceNumber ?? null,
        tax_amount: input.taxAmount ?? null,
        reimbursable: input.reimbursable ?? false,
        receipt_storage_path: input.receiptStoragePath ?? null,
        receipt_file_type: input.receiptFileType ?? null,
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

  /**
   * One payment split across multiple categories -- a single bulk insert
   * of N ordinary `expenses` rows sharing a fresh `split_group_id`, not a
   * new SECURITY DEFINER function (see migration 0089's own header
   * comment for why a plain insert is the right shape here, same
   * reasoning the recurring-expense sweep already applies): every
   * existing BEFORE INSERT trigger (numbering, receipt requirement,
   * approval gating, reimbursement sync) fires per row exactly as it
   * would for a single-category expense. A single multi-row INSERT
   * statement is atomic -- if any one split fails a trigger check (e.g.
   * a receipt-required tenant with none attached), the whole group rolls
   * back rather than leaving a partial split behind.
   */
  async recordSplitExpense(tenantId: string, input: RecordSplitExpenseInput): Promise<ExpenseRecord[]> {
    if (input.splits.length < 2) {
      throw new Error("ExpenseService.recordSplitExpense: a split needs at least 2 categories");
    }
    if (input.splits.some((s) => s.amount <= 0)) {
      throw new Error("ExpenseService.recordSplitExpense: every split amount must be greater than 0");
    }

    const categoryIds = [...new Set(input.splits.map((s) => s.categoryId))];
    const [{ data: item, error: itemError }, { data: categoryRows, error: categoryError }, { data: paymentMethod, error: paymentMethodError }] =
      await Promise.all([
        this.supabase.from("expense_items").select("name, status").eq("tenant_id", tenantId).eq("id", input.expenseItemId).single(),
        this.supabase.from("expense_categories").select("id, name, status").eq("tenant_id", tenantId).in("id", categoryIds),
        this.supabase
          .from("expense_payment_methods")
          .select("name, status")
          .eq("tenant_id", tenantId)
          .eq("id", input.paymentMethodId)
          .single(),
      ]);

    if (itemError || !item) {
      throw new Error(`ExpenseService.recordSplitExpense: ${itemError?.message ?? "expense item not found"}`);
    }
    if (item.status !== "active") {
      throw new Error("This expense item has been archived -- reactivate it before recording an expense against it.");
    }
    if (categoryError || !categoryRows || categoryRows.length !== categoryIds.length) {
      throw new Error(`ExpenseService.recordSplitExpense: ${categoryError?.message ?? "one or more categories not found"}`);
    }
    if (paymentMethodError || !paymentMethod) {
      throw new Error(`ExpenseService.recordSplitExpense: ${paymentMethodError?.message ?? "payment method not found"}`);
    }

    const categoryNameById = new Map(categoryRows.map((c) => [c.id, c.name]));
    const splitGroupId = crypto.randomUUID();

    const { data, error } = await this.supabase
      .from("expenses")
      .insert(
        input.splits.map((split) => ({
          tenant_id: tenantId,
          location_id: input.locationId,
          expense_item_id: input.expenseItemId,
          expense_item_name_snapshot: item.name,
          category_id: split.categoryId,
          category_name_snapshot: categoryNameById.get(split.categoryId) ?? "",
          payment_method_id: input.paymentMethodId,
          payment_method_name_snapshot: paymentMethod.name,
          vendor: input.vendor ?? null,
          reference_number: input.referenceNumber ?? null,
          reimbursable: input.reimbursable ?? false,
          receipt_storage_path: input.receiptStoragePath ?? null,
          receipt_file_type: input.receiptFileType ?? null,
          actual_amount: split.amount,
          expense_date: input.expenseDate,
          notes: input.notes ?? null,
          recorded_by: input.recordedBy,
          split_group_id: splitGroupId,
        }))
      )
      .select(EXPENSE_SELECT);

    if (error || !data) {
      throw new Error(`ExpenseService.recordSplitExpense: ${error?.message ?? "no rows returned"}`);
    }
    return data.map((row) => ({ ...toExpenseRecord(row), recordedByName: null }));
  }

  /** The other rows in the same split group, for the detail dialog's "part of a split" context -- excludes the row being viewed. */
  async getSplitSiblings(tenantId: string, splitGroupId: string, excludeExpenseId: string): Promise<ExpenseRecord[]> {
    const { data, error } = await this.supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("tenant_id", tenantId)
      .eq("split_group_id", splitGroupId)
      .neq("id", excludeExpenseId)
      .order("category_name_snapshot", { ascending: true });

    if (error) {
      throw new Error(`ExpenseService.getSplitSiblings: ${error.message}`);
    }
    return (data ?? []).map((row) => ({ ...toExpenseRecord(row), recordedByName: null }));
  }

  /**
   * Distinct past vendor names, most-recently-used first, for the vendor
   * autocomplete -- fetched once and filtered client-side (same "fetch
   * the full list upfront, filter in JS" shape as the item/category
   * comboboxes), not a separate query per keystroke.
   */
  async listDistinctVendors(tenantId: string, limit = 50): Promise<string[]> {
    const { data, error } = await this.supabase
      .from("expenses")
      .select("vendor, created_at")
      .eq("tenant_id", tenantId)
      .not("vendor", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(`ExpenseService.listDistinctVendors: ${error.message}`);
    }

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of data ?? []) {
      const vendor = row.vendor?.trim();
      if (vendor && !seen.has(vendor)) {
        seen.add(vendor);
        ordered.push(vendor);
      }
      if (ordered.length >= limit) break;
    }
    return ordered;
  }

  /** Defaults to a single date (today, from the caller) -- matches Sales History's own "defaults to today" precedent. */
  async listExpenses(
    tenantId: string,
    filters: {
      date?: string;
      from?: string;
      to?: string;
      q?: string;
      locationId?: string;
      categoryId?: string;
      expenseItemId?: string;
      paymentMethodId?: string;
      vendor?: string;
      status?: ExpenseStatus;
      reimbursementStatus?: ExpenseReimbursementStatus;
      hasReceipt?: boolean;
      minAmount?: number;
      maxAmount?: number;
      limit?: number;
    } = {}
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
    if (filters.locationId) {
      query = query.eq("location_id", filters.locationId);
    }
    if (filters.categoryId) {
      query = query.eq("category_id", filters.categoryId);
    }
    if (filters.expenseItemId) {
      query = query.eq("expense_item_id", filters.expenseItemId);
    }
    if (filters.paymentMethodId) {
      query = query.eq("payment_method_id", filters.paymentMethodId);
    }
    if (filters.vendor) {
      query = query.ilike("vendor", `%${filters.vendor}%`);
    }
    if (filters.status) {
      query = query.eq("status", filters.status);
    }
    if (filters.reimbursementStatus) {
      query = query.eq("reimbursement_status", filters.reimbursementStatus);
    }
    if (filters.hasReceipt === true) {
      query = query.not("receipt_storage_path", "is", null);
    } else if (filters.hasReceipt === false) {
      query = query.is("receipt_storage_path", null);
    }
    if (filters.minAmount != null) {
      query = query.gte("actual_amount", filters.minAmount);
    }
    if (filters.maxAmount != null) {
      query = query.lte("actual_amount", filters.maxAmount);
    }

    const { data, error } = await query
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(filters.limit ?? 200);

    if (error) {
      throw new Error(`ExpenseService.listExpenses: ${error.message}`);
    }
    if (!data || data.length === 0) return [];

    const recordedByIds = [...new Set(data.map((r) => r.recorded_by))];
    const { data: profiles } = await this.supabase.from("profiles").select("id, full_name").in("id", recordedByIds);
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

    return data.map((row) => ({ ...toExpenseRecord(row), recordedByName: nameById.get(row.recorded_by) ?? null }));
  }

  async correctExpense(input: {
    expenseId: string;
    reason: string;
    expenseDate: string;
    expenseItemId: string;
    categoryId: string;
    actualAmount: number;
    vendor?: string | null;
    paymentMethodId: string;
    referenceNumber?: string | null;
    taxAmount?: number | null;
    reimbursable?: boolean;
    notes?: string | null;
    receiptStoragePath?: string | null;
    receiptFileType?: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.rpc("correct_expense", {
      p_expense_id: input.expenseId,
      p_reason: input.reason,
      p_new_expense_date: input.expenseDate,
      p_new_expense_item_id: input.expenseItemId,
      p_new_category_id: input.categoryId,
      p_new_actual_amount: input.actualAmount,
      p_new_vendor: input.vendor ?? null,
      p_new_payment_method_id: input.paymentMethodId,
      p_new_reference_number: input.referenceNumber ?? null,
      p_new_tax_amount: input.taxAmount ?? null,
      p_new_reimbursable: input.reimbursable ?? false,
      p_new_notes: input.notes ?? null,
      p_new_receipt_storage_path: input.receiptStoragePath ?? null,
      p_new_receipt_file_type: input.receiptFileType ?? null,
    });

    if (error) {
      throw new Error(`ExpenseService.correctExpense: ${error.message}`);
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

  async markReimbursed(expenseId: string, reference: string | null, notes: string | null): Promise<void> {
    const { error } = await this.supabase.rpc("mark_expense_reimbursed", {
      p_expense_id: expenseId,
      p_reference: reference,
      p_notes: notes,
    });

    if (error) {
      throw new Error(`ExpenseService.markReimbursed: ${error.message}`);
    }
  }

  async listCorrections(tenantId: string, expenseId: string): Promise<ExpenseCorrection[]> {
    const { data, error } = await this.supabase
      .from("expense_corrections")
      .select("id, correction_type, old_values, new_values, reason, corrected_by, corrected_at")
      .eq("tenant_id", tenantId)
      .eq("expense_id", expenseId)
      .order("corrected_at", { ascending: false });

    if (error) {
      throw new Error(`ExpenseService.listCorrections: ${error.message}`);
    }
    if (!data || data.length === 0) return [];

    const correctorIds = [...new Set(data.map((r) => r.corrected_by))];
    const { data: profiles } = await this.supabase.from("profiles").select("id, full_name").in("id", correctorIds);
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

    return data.map((row) => ({
      id: row.id,
      correctionType: row.correction_type as "void" | "correct",
      oldValues: row.old_values,
      newValues: row.new_values,
      reason: row.reason,
      correctedBy: row.corrected_by,
      correctedByName: nameById.get(row.corrected_by) ?? null,
      correctedAt: row.corrected_at,
    }));
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

  /**
   * Backs the Expense Dashboard's summary cards. `locationId` omitted
   * means "every branch" -- only meaningful for an expenses.view_all
   * holder; RLS itself is what actually enforces that (a plain
   * expenses.view holder's query here still only ever returns their own
   * active branch's rows, view_all or not, since expenses_select's own
   * OR-branch already gates that). `byBranch` is populated regardless of
   * whether `locationId` was given -- for a single-branch view it'll just
   * be a one-entry array reflecting that branch's own totals.
   *
   * One broad query (from the earlier of week-start/month-start through
   * today), aggregated in application code -- same "fetch raw rows,
   * group in application code" convention AnalyticsService/
   * PlatformAdminService already document for themselves, rather than N
   * separate aggregate queries.
   */
  async getDashboardSummary(
    tenantId: string,
    params: { today: string; weekStart: string; monthStart: string; locationId?: string }
  ): Promise<ExpenseDashboardSummary> {
    const earliestFrom = params.weekStart < params.monthStart ? params.weekStart : params.monthStart;

    let query = this.supabase
      .from("expenses")
      .select("location_id, category_id, category_name_snapshot, vendor, actual_amount, expense_date, receipt_storage_path")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .gte("expense_date", earliestFrom)
      .lte("expense_date", params.today);

    // Separate from the "active" query above -- pending-approval expenses
    // are deliberately excluded from every total/breakdown/trend in this
    // service (they aren't real spend yet), but the dashboard still needs
    // a count/total of them so a reviewer notices there's a queue at all.
    // Not date-bounded -- a request pending for a week shouldn't quietly
    // fall out of "This Month"'s window and stop being surfaced.
    let pendingQuery = this.supabase
      .from("expenses")
      .select("actual_amount")
      .eq("tenant_id", tenantId)
      .eq("status", "pending_approval");

    // Same "not date-bounded" reasoning as pendingQuery above -- an unpaid
    // reimbursement from last month shouldn't quietly fall out of view
    // just because it's outside "This Month"'s window. Only 'active'
    // expenses can ever have reimbursement_status = 'pending' (the
    // gate_expense_approval/sync_reimbursement_status triggers never set
    // it on a pending/rejected row), so no extra status filter needed.
    let pendingReimbursementQuery = this.supabase
      .from("expenses")
      .select("actual_amount")
      .eq("tenant_id", tenantId)
      .eq("reimbursement_status", "pending");

    if (params.locationId) {
      query = query.eq("location_id", params.locationId);
      pendingQuery = pendingQuery.eq("location_id", params.locationId);
      pendingReimbursementQuery = pendingReimbursementQuery.eq("location_id", params.locationId);
    }

    const [
      { data, error },
      { data: pendingData, error: pendingError },
      { data: pendingReimbursementData, error: pendingReimbursementError },
    ] = await Promise.all([query, pendingQuery, pendingReimbursementQuery]);
    if (error) {
      throw new Error(`ExpenseService.getDashboardSummary: ${error.message}`);
    }
    if (pendingError) {
      throw new Error(`ExpenseService.getDashboardSummary: ${pendingError.message}`);
    }
    if (pendingReimbursementError) {
      throw new Error(`ExpenseService.getDashboardSummary: ${pendingReimbursementError.message}`);
    }

    const rows = data ?? [];
    let todayTotal = 0;
    let thisWeekTotal = 0;
    let thisMonthTotal = 0;
    let withoutReceiptCount = 0;
    const byBranchMap = new Map<string, ExpenseDashboardBranchTotal>();
    const byCategoryMap = new Map<string, { id: string; name: string; total: number }>();
    const byVendorMap = new Map<string, number>();

    for (const row of rows) {
      const amount = Number(row.actual_amount);
      if (row.expense_date === params.today) todayTotal += amount;
      if (row.expense_date >= params.weekStart) thisWeekTotal += amount;
      if (row.expense_date >= params.monthStart) thisMonthTotal += amount;
      if (!row.receipt_storage_path) withoutReceiptCount += 1;

      const branch = byBranchMap.get(row.location_id) ?? { locationId: row.location_id, total: 0, count: 0 };
      branch.total += amount;
      branch.count += 1;
      byBranchMap.set(row.location_id, branch);

      if (row.category_id && row.category_name_snapshot) {
        const category = byCategoryMap.get(row.category_id) ?? { id: row.category_id, name: row.category_name_snapshot, total: 0 };
        category.total += amount;
        byCategoryMap.set(row.category_id, category);
      }

      if (row.vendor) {
        byVendorMap.set(row.vendor, (byVendorMap.get(row.vendor) ?? 0) + amount);
      }
    }

    const topCategory = [...byCategoryMap.values()].sort((a, b) => b.total - a.total)[0] ?? null;
    const topVendorEntry = [...byVendorMap.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
      todayTotal,
      thisWeekTotal,
      thisMonthTotal,
      byBranch: [...byBranchMap.values()].sort((a, b) => b.total - a.total),
      topCategoryId: topCategory?.id ?? null,
      topCategoryName: topCategory?.name ?? null,
      topVendor: topVendorEntry?.[0] ?? null,
      withoutReceiptCount,
      pendingApprovalCount: pendingData?.length ?? 0,
      pendingApprovalTotal: (pendingData ?? []).reduce((sum, row) => sum + Number(row.actual_amount), 0),
      pendingReimbursementCount: pendingReimbursementData?.length ?? 0,
      pendingReimbursementTotal: (pendingReimbursementData ?? []).reduce((sum, row) => sum + Number(row.actual_amount), 0),
    };
  }

  /**
   * A single generic aggregator for every non-item breakdown dimension
   * (by-item already has its own richer shape via getSummary/byItem,
   * including estimated-amount comparison, which the other dimensions
   * have no equivalent of) -- one method instead of five near-duplicates
   * that would only ever differ in which column they group by.
   */
  async getBreakdown(
    tenantId: string,
    dimension: ExpenseBreakdownDimension,
    filters: { from: string; to: string; locationId?: string }
  ): Promise<ExpenseBreakdownEntry[]> {
    let query = this.supabase
      .from("expenses")
      .select("location_id, category_id, category_name_snapshot, payment_method_id, payment_method_name_snapshot, vendor, recorded_by, actual_amount")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .gte("expense_date", filters.from)
      .lte("expense_date", filters.to);

    if (filters.locationId) {
      query = query.eq("location_id", filters.locationId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`ExpenseService.getBreakdown: ${error.message}`);
    }

    const rows = data ?? [];
    const map = new Map<string, ExpenseBreakdownEntry>();

    function bucket(key: string | null, label: string | null, amount: number) {
      if (!key || !label) return;
      const entry = map.get(key) ?? { key, label, total: 0, count: 0 };
      entry.total += amount;
      entry.count += 1;
      map.set(key, entry);
    }

    for (const row of rows) {
      const amount = Number(row.actual_amount);
      switch (dimension) {
        case "category":
          bucket(row.category_id, row.category_name_snapshot, amount);
          break;
        case "vendor":
          bucket(row.vendor, row.vendor, amount);
          break;
        case "paymentMethod":
          bucket(row.payment_method_id, row.payment_method_name_snapshot, amount);
          break;
        case "branch":
          bucket(row.location_id, row.location_id, amount);
          break;
        case "recordedBy":
          bucket(row.recorded_by, row.recorded_by, amount);
          break;
      }
    }

    let entries = [...map.values()];

    // "branch"/"recordedBy" bucket by id with the id itself as a
    // placeholder label (this service doesn't own locations/profiles) --
    // resolve real names in one batched follow-up query and rewrite the
    // labels in place, so the caller never has to know this happened.
    if (dimension === "branch" && entries.length > 0) {
      const { data: locations } = await this.supabase.from("locations").select("id, name").in(
        "id",
        entries.map((e) => e.key)
      );
      const nameById = new Map((locations ?? []).map((l) => [l.id, l.name]));
      entries = entries.map((e) => ({ ...e, label: nameById.get(e.key) ?? e.label }));
    } else if (dimension === "recordedBy" && entries.length > 0) {
      const { data: profiles } = await this.supabase.from("profiles").select("id, full_name").in(
        "id",
        entries.map((e) => e.key)
      );
      const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
      entries = entries.map((e) => ({ ...e, label: nameById.get(e.key) ?? "Unknown" }));
    }

    return entries.sort((a, b) => b.total - a.total);
  }

  /** Daily totals across the given range -- a one-point range never renders a meaningful trend, same convention SalesTrendChart already applies (caller decides the &lt; 2 cutoff). */
  async getTrend(tenantId: string, filters: { from: string; to: string; locationId?: string }): Promise<ExpenseTrendPoint[]> {
    let query = this.supabase
      .from("expenses")
      .select("expense_date, actual_amount")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .gte("expense_date", filters.from)
      .lte("expense_date", filters.to);

    if (filters.locationId) {
      query = query.eq("location_id", filters.locationId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`ExpenseService.getTrend: ${error.message}`);
    }

    const totalsByDate = new Map<string, number>();
    for (const row of data ?? []) {
      totalsByDate.set(row.expense_date, (totalsByDate.get(row.expense_date) ?? 0) + Number(row.actual_amount));
    }

    return [...totalsByDate.entries()].map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date));
  }
}
