"use server";

import { ReportService, type DailySalesSummary } from "@/services/ReportService";
import { assertCan } from "@/lib/permissions/can";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface DailySalesReportData extends DailySalesSummary {
  tenantName: string;
  adminEmail: string;
  currency: string;
  reportDate: string;
  generatedAt: string;
}

/**
 * Product Enhancements #7's Daily Report data. Runs on the service-role
 * client (see lib/supabase/service-role.ts's allowed-callers list) after
 * an explicit reports.view check -- the poster is a business-wide
 * summary ("Business/Tenant Name", "Tenant Admin Email"), not a
 * personal one, so it must include every sale for the day regardless of
 * whether the caller personally holds sales.view_all or only
 * sales.view_own.
 */
export async function getDailySalesReportAction(tenantId: string, date: string): Promise<DailySalesReportData> {
  await assertCan("reports.view", { tenantId });

  const svc = createServiceRoleClient();

  const [{ data: tenant }, summary] = await Promise.all([
    svc.from("tenants").select("name, currency, billing_owner_profile_id").eq("id", tenantId).single(),
    new ReportService(svc).getDailySalesSummary(tenantId, date),
  ]);

  let adminEmail = "";
  if (tenant?.billing_owner_profile_id) {
    const { data: owner } = await svc
      .from("profiles")
      .select("email")
      .eq("id", tenant.billing_owner_profile_id)
      .maybeSingle();
    adminEmail = owner?.email ?? "";
  }

  return {
    ...summary,
    tenantName: tenant?.name ?? "",
    adminEmail,
    currency: tenant?.currency ?? "",
    reportDate: date,
    generatedAt: new Date().toISOString(),
  };
}
