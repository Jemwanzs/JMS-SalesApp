"use server";

import { ExpenseService, type ExpenseBreakdownDimension } from "@/services/ExpenseService";
import { assertCan } from "@/lib/permissions/can";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const DIMENSION_LABELS: Record<ExpenseBreakdownDimension, string> = {
  category: "By Category",
  vendor: "By Vendor",
  paymentMethod: "By Payment Method",
  branch: "By Branch",
  recordedBy: "By Employee",
};

export interface ExpenseReportEntry {
  label: string;
  total: number;
  count: number;
}

export interface ExpenseReportData {
  tenantName: string;
  currency: string;
  fromDate: string;
  toDate: string;
  generatedAt: string;
  totalAmount: number;
  count: number;
  dimensionLabel: string;
  entries: ExpenseReportEntry[];
}

/**
 * Building block for both the PDF report and (in principle) any future
 * export format -- assembles one flexible, filterable report rather than
 * building out 11 bespoke named report screens/routes, matching how
 * Sales Reports already works. Runs on the service-role client after an
 * explicit permission check, same shape as getDailySalesReportAction.
 */
export async function getExpenseReportAction(
  tenantId: string,
  filters: { from: string; to: string; locationId?: string },
  dimension: ExpenseBreakdownDimension
): Promise<ExpenseReportData> {
  await assertCan("expenses.view_analytics", { tenantId });
  await assertCan("expenses.export", { tenantId });

  const svc = createServiceRoleClient();

  const [{ data: tenant }, entries] = await Promise.all([
    svc.from("tenants").select("name, currency").eq("id", tenantId).single(),
    new ExpenseService(svc).getBreakdown(tenantId, dimension, filters),
  ]);

  const totalAmount = entries.reduce((sum, e) => sum + e.total, 0);
  const count = entries.reduce((sum, e) => sum + e.count, 0);

  return {
    tenantName: tenant?.name ?? "",
    currency: tenant?.currency ?? "",
    fromDate: filters.from,
    toDate: filters.to,
    generatedAt: new Date().toISOString(),
    totalAmount,
    count,
    dimensionLabel: DIMENSION_LABELS[dimension],
    entries: entries.map((e) => ({ label: e.label, total: e.total, count: e.count })),
  };
}
