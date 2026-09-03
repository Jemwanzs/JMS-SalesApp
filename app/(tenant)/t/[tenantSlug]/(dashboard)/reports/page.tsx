import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { ReportList } from "@/features/reports/components/report-list";
import { BusinessDayService } from "@/services/BusinessDayService";
import { ReportService } from "@/services/ReportService";
import { TenantService } from "@/services/TenantService";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
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
 *
 * Reports Must Always Be Available: today's daily sales figures are
 * always shown -- computed live from `sales` (real numbers, or zeros if
 * nothing's been recorded yet) rather than waiting for a `reports` row
 * that only gets written once the business day closes and the outbox
 * worker drains. Labeled "Today -- Live" while the day is open/reopened,
 * "Closed -- Final" once it closes (see ReportService.computeDailyReportPayload's
 * own header comment) -- the day-close workflow finalizes the day's
 * transactions, it never gates whether reports can be VIEWED.
 */
export default async function ReportsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();
  const t = await getTranslations("Reports");

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  // See sales-history/page.tsx's identical guard for why this can't just
  // rely on the tenant layout's own redirect/notFound.
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  // Reporting Tabs (Settings): defense in depth alongside BottomNav's
  // own gate on this same setting -- see sales-history/page.tsx's
  // identical guard.
  const reportsEnabled = await new TenantService(supabase).getSetting<boolean>(tenant.id, "reports_enabled");
  if (reportsEnabled === false) {
    redirect(`/t/${tenantSlug}/sales`);
  }

  const reportService = new ReportService(supabase);
  const businessDayService = new BusinessDayService(supabase);

  const activeLocationId = await resolveActiveLocationId(supabase, tenant.id);

  // Business Day Rollover: `todayDate` is the EFFECTIVE business date
  // (getEffectiveBusinessDate), not a raw calendar computation -- for a
  // cross-midnight tenant, an independent `new Date()`-based "today"
  // here would resolve to tomorrow's (not-yet-open) date the moment the
  // calendar rolls over, computing a blank live report for a business
  // day that's still very much open. See BusinessDayService's own
  // header comments (migration 0055) for the full resolution order.
  const [storedReports, effectiveDate] = await Promise.all([
    reportService.listReports(tenant.id),
    activeLocationId ? businessDayService.getEffectiveBusinessDate(tenant.id, activeLocationId) : Promise.resolve(null),
  ]);
  const todayDate = effectiveDate?.date ?? null;

  let reports: Array<(typeof storedReports)[number] & { status: "live" | "final" }> = storedReports.map((r) => ({
    ...r,
    status: "final",
  }));

  if (activeLocationId && todayDate) {
    const todayPayload = await reportService.computeDailyReportPayload(tenant.id, activeLocationId, todayDate);

    // Excludes any stored "daily" row already covering today -- the
    // live-computed entry above always supersedes it (same computation,
    // guaranteed fresher), so showing both would just duplicate the day.
    reports = reports.filter((r) => !(r.reportType === "daily" && r.periodStart === todayDate));

    reports = [
      {
        id: `live-daily-${todayDate}`,
        reportType: "daily",
        periodStart: todayDate,
        periodEnd: todayDate,
        payload: todayPayload,
        createdAt: new Date().toISOString(),
        // effectiveDate.isLive is the direct signal (true only while a
        // business day is genuinely open/reopened right now) -- more
        // reliable than re-deriving it from todayBusinessDay?.status,
        // which is null (not "open") during the gap between closing and
        // the next opening, same as a genuinely closed day would be.
        status: effectiveDate?.isLive ? "live" : "final",
      },
      ...reports,
    ];
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <h1 className="mb-4 text-xl font-semibold">{t("heading")}</h1>
      <ReportList reports={reports} />
    </div>
  );
}
