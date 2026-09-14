"use server";

import ExcelJS from "exceljs";
import { headers } from "next/headers";

import { getExpenseReportAction } from "@/features/expenses/actions/get-expense-report";
import type { ExpensesExportFilters } from "@/features/expenses/actions/export-expenses-csv";
import { AuditService } from "@/services/AuditService";
import { DownloadService } from "@/services/DownloadService";
import { ExpenseService, type ExpenseBreakdownDimension } from "@/services/ExpenseService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ExportExpensesExcelState {
  error?: string;
  excelBase64?: string;
  filename?: string;
}

/**
 * The Excel leg of Phase 1's "CSV + PDF first" scoping decision --
 * exceljs is already a dependency (used server-side for import
 * templates, ImportService.ts), just never wired up for an export
 * before. Same passcode-gated/audit/download-logging shape as
 * export-expenses-csv.ts; the only real difference is the payload is
 * binary, so it crosses the server-action boundary as base64 (a report-
 * sized workbook is never large enough for that ~33% overhead to
 * matter) and the client decodes it back into a Blob -- see
 * ExpenseReportExportBar's triggerDownloadBytes.
 *
 * Two sheets rather than one flat table (which CSV already covers):
 * "Summary" reuses getExpenseReportAction's own breakdown-by-dimension
 * data (the same building block the PDF report already renders, one
 * assembly used by every export format) with a bold total row, and
 * "Detail" is the same row set export-expenses-csv.ts writes, but with
 * Amount/Tax as real numeric cells (Excel-native sorting/formulas)
 * instead of formatted strings.
 */
export async function exportExpensesExcelAction(
  tenantId: string,
  filters: ExpensesExportFilters,
  dimension: ExpenseBreakdownDimension,
  passcode: string | null
): Promise<ExportExpensesExcelState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("expenses.view", { tenantId });
    await assertCan("expenses.export", { tenantId });
  } catch {
    return { error: "Not authorized to export expenses" };
  }

  const auditService = new AuditService(createServiceRoleClient());
  await auditService
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.EXPORT_REQUESTED,
      entityType: "expenses_excel",
      metadata: { ...filters, dimension },
    })
    .catch(() => {});

  const downloadService = new DownloadService(supabase);
  const requiresPasscode = await new TenantService(supabase).getSetting<boolean>(tenantId, "require_download_passcode");

  let passcodeVerifiedAt: string | null = null;
  if (requiresPasscode === true) {
    const valid = await downloadService.verifyPasscode(tenantId, passcode ?? "");
    if (!valid) {
      return { error: "Incorrect passcode" };
    }
    passcodeVerifiedAt = new Date().toISOString();
  }

  const [report, expenses] = await Promise.all([
    getExpenseReportAction(tenantId, { from: filters.from ?? "", to: filters.to ?? "", locationId: filters.locationId }, dimension),
    new ExpenseService(supabase).listExpenses(tenantId, {
      from: filters.from,
      to: filters.to,
      categoryId: filters.categoryId,
      locationId: filters.locationId,
      limit: 5000,
    }),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = report.tenantName || "JMS Sales App";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: report.dimensionLabel.replace("By ", ""), key: "label", width: 30 },
    { header: "Count", key: "count", width: 12 },
    { header: "Amount", key: "total", width: 16 },
  ];
  for (const entry of report.entries) {
    summarySheet.addRow({ label: entry.label, count: entry.count, total: entry.total });
  }
  if (report.entries.length === 0) {
    summarySheet.addRow({ label: "No expenses recorded for this range." });
  }
  summarySheet.addRow({});
  const totalRow = summarySheet.addRow({ label: "Total", count: report.count, total: report.totalAmount });
  totalRow.font = { bold: true };
  summarySheet.getColumn("total").numFmt = "#,##0.00";
  summarySheet.getRow(1).font = { bold: true };

  const detailSheet = workbook.addWorksheet("Detail");
  detailSheet.columns = [
    { header: "Expense Number", key: "expenseNumber", width: 16 },
    { header: "Date", key: "date", width: 12 },
    { header: "Item", key: "item", width: 20 },
    { header: "Category", key: "category", width: 16 },
    { header: "Vendor", key: "vendor", width: 18 },
    { header: "Payment Method", key: "paymentMethod", width: 16 },
    { header: "Amount", key: "amount", width: 14 },
    { header: "Tax", key: "tax", width: 12 },
    { header: "Reimbursable", key: "reimbursable", width: 14 },
    { header: "Reimbursement Status", key: "reimbursementStatus", width: 18 },
    { header: "Receipt", key: "receipt", width: 10 },
    { header: "Recorded By", key: "recordedBy", width: 18 },
    { header: "Status", key: "status", width: 14 },
  ];
  for (const e of expenses) {
    detailSheet.addRow({
      expenseNumber: e.expenseNumber ?? "",
      date: e.expenseDate,
      item: e.expenseItemName,
      category: e.categoryName ?? "",
      vendor: e.vendor ?? "",
      paymentMethod: e.paymentMethodName ?? "",
      amount: e.actualAmount,
      tax: e.taxAmount ?? "",
      reimbursable: e.reimbursable ? "Yes" : "No",
      reimbursementStatus: e.reimbursementStatus,
      receipt: e.receiptStoragePath ? "Yes" : "No",
      recordedBy: e.recordedByName ?? "",
      status: e.status,
    });
  }
  detailSheet.getColumn("amount").numFmt = "#,##0.00";
  detailSheet.getColumn("tax").numFmt = "#,##0.00";
  detailSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;

  await downloadService.logDownload({
    tenantId,
    profileId: user.id,
    exportType: "expenses_excel",
    entityRef: JSON.stringify(filters),
    passcodeVerifiedAt,
    ip,
  });

  await auditService
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.EXPORT_COMPLETED,
      entityType: "expenses_excel",
      ipAddress: ip,
      metadata: { ...filters, rowCount: expenses.length },
    })
    .catch(() => {});

  return {
    excelBase64: Buffer.from(buffer).toString("base64"),
    filename: `expenses-${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}
