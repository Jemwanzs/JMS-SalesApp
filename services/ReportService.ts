import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * ReportService — scheduled report generation. Daily report only for now
 * (docs/09-business-day-engine.md's "Daily sales summary": gross sales,
 * transaction count, top product, highest sales person, average sale, vs
 * previous day) — weekly/monthly/custom and corrections/void reports are
 * later Phase 3 increments, not yet implemented.
 *
 * Called exclusively by the outbox-drain worker (app/api/cron/outbox),
 * never synchronously inside the pg_cron sweep transaction that queues
 * the report_jobs row (migration 0011) — see docs/09-business-day-
 * engine.md's outbox-pattern rationale.
 *
 * Uses each sale's own `product_name_snapshot`/`recorded_by`, not a live
 * join to the current catalog/profile — a daily report is a historical
 * record of that specific day, so it should read the same regardless of
 * later renames, unlike AnalyticsService's arbitrary-range product
 * performance (which intentionally uses current catalog identity, see
 * docs/08-sales-engine.md's snapshot-vs-current decision log — the two
 * services deliberately differ here for different reasons).
 */
export interface DailyReportPayload {
  grossSales: number;
  transactionCount: number;
  averageSale: number;
  topProduct: { name: string; revenue: number } | null;
  topSalesPerson: { name: string; revenue: number } | null;
  vsPreviousDay: { previousGrossSales: number; changePercent: number | null } | null;
}

export class ReportService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async generateDailyReport(businessDayId: string): Promise<string> {
    const { data: businessDay, error: dayError } = await this.supabase
      .from("business_days")
      .select("id, tenant_id, location_id, business_date, aggregates")
      .eq("id", businessDayId)
      .single();

    if (dayError || !businessDay) {
      throw new Error(`ReportService.generateDailyReport: business day not found`);
    }

    const { data: sales, error: salesError } = await this.supabase
      .from("sales")
      .select("product_name_snapshot, actual_amount, recorded_by")
      .eq("business_day_id", businessDayId)
      .neq("status", "voided");

    if (salesError) {
      throw new Error(`ReportService.generateDailyReport: ${salesError.message}`);
    }

    const aggregates = businessDay.aggregates as { grossSales?: number; transactionCount?: number };
    const grossSales = aggregates.grossSales ?? 0;
    const transactionCount = aggregates.transactionCount ?? 0;
    const averageSale = transactionCount > 0 ? grossSales / transactionCount : 0;

    const topProduct = topBy(sales ?? [], (s) => s.product_name_snapshot);

    let topSalesPerson: DailyReportPayload["topSalesPerson"] = null;
    const topRecorder = topBy(sales ?? [], (s) => s.recorded_by);
    if (topRecorder) {
      const { data: profile } = await this.supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", topRecorder.key)
        .maybeSingle();
      topSalesPerson = {
        name: profile?.full_name ?? profile?.email ?? "Unknown",
        revenue: topRecorder.revenue,
      };
    }

    let vsPreviousDay: DailyReportPayload["vsPreviousDay"] = null;
    if (businessDay.location_id) {
      const { data: previousDay } = await this.supabase
        .from("business_days")
        .select("aggregates")
        .eq("tenant_id", businessDay.tenant_id)
        .eq("location_id", businessDay.location_id)
        .eq("status", "closed")
        .lt("business_date", businessDay.business_date)
        .order("business_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (previousDay) {
        const previousGrossSales =
          (previousDay.aggregates as { grossSales?: number }).grossSales ?? 0;
        vsPreviousDay = {
          previousGrossSales,
          changePercent:
            previousGrossSales > 0
              ? ((grossSales - previousGrossSales) / previousGrossSales) * 100
              : null,
        };
      }
    }

    const payload: DailyReportPayload = {
      grossSales,
      transactionCount,
      averageSale,
      topProduct: topProduct ? { name: topProduct.key, revenue: topProduct.revenue } : null,
      topSalesPerson,
      vsPreviousDay,
    };

    const { data: report, error: reportError } = await this.supabase
      .from("reports")
      .insert({
        tenant_id: businessDay.tenant_id,
        location_id: businessDay.location_id,
        report_type: "daily",
        period_start: businessDay.business_date,
        period_end: businessDay.business_date,
        status: "completed",
        payload: payload as unknown as Record<string, unknown>,
      })
      .select("id")
      .single();

    if (reportError || !report) {
      throw new Error(`ReportService.generateDailyReport: ${reportError?.message}`);
    }

    return report.id;
  }

  /**
   * RLS (reports_select, migration 0013) already restricts rows to
   * holders of reports.view -- no separate permission check needed here.
   */
  async listReports(
    tenantId: string,
    opts: { limit?: number } = {}
  ): Promise<Array<{ id: string; reportType: string; periodStart: string; periodEnd: string; payload: DailyReportPayload; createdAt: string }>> {
    const { data, error } = await this.supabase
      .from("reports")
      .select("id, report_type, period_start, period_end, payload, created_at")
      .eq("tenant_id", tenantId)
      .order("period_start", { ascending: false })
      .limit(opts.limit ?? 30);

    if (error) {
      throw new Error(`ReportService.listReports: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      reportType: row.report_type,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      payload: row.payload as unknown as DailyReportPayload,
      createdAt: row.created_at,
    }));
  }
}

function topBy<T>(
  rows: T[],
  keyOf: (row: T) => string
): { key: string; revenue: number } | null {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row);
    const amount = Number((row as { actual_amount: number }).actual_amount);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }

  let best: { key: string; revenue: number } | null = null;
  for (const [key, revenue] of totals) {
    if (!best || revenue > best.revenue) {
      best = { key, revenue };
    }
  }
  return best;
}
