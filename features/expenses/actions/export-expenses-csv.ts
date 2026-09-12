"use server";

import { headers } from "next/headers";

import { AuditService } from "@/services/AuditService";
import { DownloadService } from "@/services/DownloadService";
import { ExpenseService } from "@/services/ExpenseService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toCsv } from "@/lib/utils/csv";

export interface ExportExpensesState {
  error?: string;
  csv?: string;
  filename?: string;
}

export interface ExpensesExportFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  locationId?: string;
}

/**
 * Structural clone of export-sales-history.ts: passcode-gated (same
 * require_download_passcode setting), audit-logged, re-runs
 * ExpenseService.listExpenses server-side with the caller's filters --
 * never trusts client-rendered rows. Gated on BOTH expenses.export and
 * expenses.view (exporting without being able to view at all makes no
 * sense, same "export needs the underlying view permission too"
 * reasoning the sales export already follows implicitly via its own
 * view_all/view_own check).
 */
export async function exportExpensesCsvAction(
  tenantId: string,
  filters: ExpensesExportFilters,
  passcode: string | null
): Promise<ExportExpensesState> {
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
      entityType: "expenses_csv",
      metadata: { ...filters },
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

  const expenses = await new ExpenseService(supabase).listExpenses(tenantId, {
    from: filters.from,
    to: filters.to,
    categoryId: filters.categoryId,
    locationId: filters.locationId,
    limit: 5000,
  });

  const csv = toCsv([
    ["Expense Number", "Date", "Item", "Category", "Vendor", "Payment Method", "Amount", "Tax", "Reimbursable", "Receipt", "Recorded By", "Status"],
    ...expenses.map((e) => [
      e.expenseNumber ?? "",
      e.expenseDate,
      e.expenseItemName,
      e.categoryName ?? "",
      e.vendor ?? "",
      e.paymentMethodName ?? "",
      e.actualAmount.toFixed(2),
      e.taxAmount != null ? e.taxAmount.toFixed(2) : "",
      e.reimbursable ? "Yes" : "No",
      e.receiptStoragePath ? "Yes" : "No",
      e.recordedByName ?? "",
      e.status,
    ]),
  ]);

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;

  await downloadService.logDownload({
    tenantId,
    profileId: user.id,
    exportType: "expenses_csv",
    entityRef: JSON.stringify(filters),
    passcodeVerifiedAt,
    ip,
  });

  await auditService
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.EXPORT_COMPLETED,
      entityType: "expenses_csv",
      ipAddress: ip,
      metadata: { ...filters, rowCount: expenses.length },
    })
    .catch(() => {});

  return { csv, filename: `expenses-${new Date().toISOString().slice(0, 10)}.csv` };
}
