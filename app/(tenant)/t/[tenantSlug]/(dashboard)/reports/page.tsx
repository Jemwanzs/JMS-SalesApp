import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ReportList } from "@/features/reports/components/report-list";
import { ReportService } from "@/services/ReportService";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Reports | JMS Sales App",
};

/**
 * Phase 3c: daily reports only for now (weekly/monthly/custom + the
 * rule-based insights engine are later Phase 3 increments). Only
 * reachable by roles with reports.view (BottomNav's permission gating) --
 * RLS (reports_select, migration 0013) enforces the same gate directly on
 * the query regardless.
 */
export default async function ReportsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();
  const t = await getTranslations("Reports");

  const tenant = await getTenantBySlug(supabase, tenantSlug);

  const reports = await new ReportService(supabase).listReports(tenant!.id);

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">{t("heading")}</h1>
      <ReportList reports={reports} />
    </div>
  );
}
