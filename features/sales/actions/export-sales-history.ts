"use server";

import { headers } from "next/headers";

import { AuditService } from "@/services/AuditService";
import { DownloadService } from "@/services/DownloadService";
import { SalesService } from "@/services/SalesService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toCsv } from "@/lib/utils/csv";

export interface ExportSalesHistoryState {
  error?: string;
  csv?: string;
  filename?: string;
}

/**
 * docs/05's download-security flow (Enter Passcode → Validate →
 * Permission Check → Generate File → download_audit event), applied to
 * the one export surface that exists today (Sales History's CSV
 * button, previously a pure client-side Blob build over whatever rows
 * were already on the page). Moved server-side so the passcode check
 * and the sales query both run under real RLS/permission enforcement
 * rather than trusting the client's already-rendered array — the
 * server re-runs SalesService.listRecent() with the same filters
 * sale-history-list.tsx's caller already applied, it doesn't reuse
 * client-supplied rows.
 */
export async function exportSalesHistoryCsvAction(
  tenantId: string,
  filters: { from?: string; to?: string; q?: string },
  passcode: string | null
): Promise<ExportSalesHistoryState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const canViewAll = await can("sales.view_all", { tenantId });
  const canViewOwn = await can("sales.view_own", { tenantId });
  if (!canViewAll && !canViewOwn) {
    return { error: "Not authorized to view sales" };
  }

  const auditService = new AuditService(createServiceRoleClient());
  await auditService
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.EXPORT_REQUESTED,
      entityType: "sales_history_csv",
      metadata: filters,
    })
    .catch(() => {});

  const downloadService = new DownloadService(supabase);
  const requiresPasscode = await new TenantService(supabase).getSetting<boolean>(
    tenantId,
    "require_download_passcode"
  );

  let passcodeVerifiedAt: string | null = null;
  if (requiresPasscode === true) {
    const valid = await downloadService.verifyPasscode(tenantId, passcode ?? "");
    if (!valid) {
      return { error: "Incorrect passcode" };
    }
    passcodeVerifiedAt = new Date().toISOString();
  }

  const hasFilters = Boolean(filters.from || filters.to || filters.q);
  const sales = await new SalesService(supabase).listRecent(tenantId, {
    limit: hasFilters ? 500 : 100,
    dateFrom: filters.from,
    dateTo: filters.to,
    search: filters.q,
  });

  const csv = toCsv([
    ["Sale Number", "Product", "Amount", "Quantity", "Status", "Recorded At"],
    ...sales.map((s) => [
      s.saleNumber ?? "",
      s.productNameSnapshot,
      s.actualAmount.toFixed(2),
      s.quantity ?? "",
      s.status,
      new Date(s.saleTime).toISOString(),
    ]),
  ]);

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;

  await downloadService.logDownload({
    tenantId,
    profileId: user.id,
    exportType: "sales_history_csv",
    entityRef: JSON.stringify(filters),
    passcodeVerifiedAt,
    ip,
  });

  await auditService
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.EXPORT_COMPLETED,
      entityType: "sales_history_csv",
      ipAddress: ip,
      metadata: { ...filters, rowCount: sales.length },
    })
    .catch(() => {});

  return { csv, filename: `sales-history-${new Date().toISOString().slice(0, 10)}.csv` };
}
