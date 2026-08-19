import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * ReportService — scheduled report generation. Daily sales report + a
 * daily corrections/void report (docs/09-business-day-engine.md's
 * "Daily sales summary"; spec §38's "Sales Corrections"/"Void/Reversal
 * Report" combined into one report_type here, both covering the same
 * "what changed today" question). Weekly/monthly/custom report types are
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

export interface CorrectionsReportEntry {
  saleNumber: string | null;
  productName: string;
  correctionType: "void" | "correct" | "reverse";
  reason: string;
  oldAmount: number;
  newAmount: number | null;
  requestedBy: string;
  createdAt: string;
}

export interface CorrectionsReportPayload {
  voidCount: number;
  correctionCount: number;
  reversalCount: number;
  totalVoided: number;
  totalCorrectedDelta: number;
  totalReversed: number;
  entries: CorrectionsReportEntry[];
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

    // Excludes 'corrected' too -- see AnalyticsService.getAnalytics's
    // own comment on this exact filter.
    const { data: sales, error: salesError } = await this.supabase
      .from("sales")
      .select("product_name_snapshot, actual_amount, recorded_by")
      .eq("business_day_id", businessDayId)
      .neq("status", "voided")
      .neq("status", "corrected");

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
   * Skipped (returns null, no row written) when nothing was voided or
   * corrected that day -- an empty report for every ordinary day would
   * just be noise, unlike the daily sales report which is meaningful
   * even at zero sales.
   *
   * `sale_corrections.old_values`/`new_values` (migration 0006) already
   * carry the original sale's full snapshot as jsonb (`to_jsonb(sale)`),
   * including `location_id` -- filtering on `old_values->>location_id`
   * avoids a second join back to `sales` entirely.
   *
   * "That day" is approximated as `created_at` within the business day's
   * calendar date in UTC, not the location's own effective timezone --
   * an acceptable approximation at the same rigor level as the rest of
   * this increment (a correction is a rare, already-reviewed event, not
   * a high-volume figure where a timezone-boundary sale could visibly
   * move totals the way it would for the daily sales report).
   */
  async generateCorrectionsReport(businessDayId: string): Promise<string | null> {
    const { data: businessDay, error: dayError } = await this.supabase
      .from("business_days")
      .select("id, tenant_id, location_id, business_date")
      .eq("id", businessDayId)
      .single();

    if (dayError || !businessDay) {
      throw new Error("ReportService.generateCorrectionsReport: business day not found");
    }

    const dayStart = `${businessDay.business_date}T00:00:00Z`;
    const dayEnd = new Date(new Date(dayStart).getTime() + 86_400_000).toISOString();

    const { data: corrections, error: correctionsError } = await this.supabase
      .from("sale_corrections")
      .select("correction_type, old_values, new_values, reason, requested_by, created_at")
      .eq("tenant_id", businessDay.tenant_id)
      .eq("old_values->>location_id", businessDay.location_id)
      .gte("created_at", dayStart)
      .lt("created_at", dayEnd);

    if (correctionsError) {
      throw new Error(`ReportService.generateCorrectionsReport: ${correctionsError.message}`);
    }
    if (!corrections || corrections.length === 0) {
      return null;
    }

    const requesterIds = [...new Set(corrections.map((c) => c.requested_by))];
    const { data: profiles } = await this.supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", requesterIds);
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));

    let voidCount = 0;
    let correctionCount = 0;
    let reversalCount = 0;
    let totalVoided = 0;
    let totalCorrectedDelta = 0;
    let totalReversed = 0;
    const entries: CorrectionsReportEntry[] = [];

    for (const row of corrections) {
      const oldValues = row.old_values as {
        sale_number: string | null;
        product_name_snapshot: string;
        actual_amount: number;
      };
      const newValues = row.new_values as { actual_amount: number } | null;
      const oldAmount = Number(oldValues.actual_amount);
      const newAmount = newValues ? Number(newValues.actual_amount) : null;

      if (row.correction_type === "void") {
        voidCount += 1;
        totalVoided += oldAmount;
      } else if (row.correction_type === "reverse") {
        // Unlike a correction's newAmount (a corrected replacement
        // figure), the reversal row's newAmount is the NEGATED original
        // -- reported as its own "reversed" total, not folded into
        // totalCorrectedDelta, since it isn't a delta on the original
        // figure at all, it's an offsetting entry alongside it.
        reversalCount += 1;
        totalReversed += oldAmount;
      } else {
        correctionCount += 1;
        totalCorrectedDelta += (newAmount ?? oldAmount) - oldAmount;
      }

      entries.push({
        saleNumber: oldValues.sale_number,
        productName: oldValues.product_name_snapshot,
        correctionType: row.correction_type,
        reason: row.reason,
        oldAmount,
        newAmount,
        requestedBy: nameById.get(row.requested_by) ?? "Unknown",
        createdAt: row.created_at,
      });
    }

    const payload: CorrectionsReportPayload = {
      voidCount,
      correctionCount,
      reversalCount,
      totalVoided,
      totalCorrectedDelta,
      totalReversed,
      entries,
    };

    const { data: report, error: reportError } = await this.supabase
      .from("reports")
      .insert({
        tenant_id: businessDay.tenant_id,
        location_id: businessDay.location_id,
        report_type: "corrections_void",
        period_start: businessDay.business_date,
        period_end: businessDay.business_date,
        status: "completed",
        payload: payload as unknown as Record<string, unknown>,
      })
      .select("id")
      .single();

    if (reportError || !report) {
      throw new Error(`ReportService.generateCorrectionsReport: ${reportError?.message}`);
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
  ): Promise<
    Array<{
      id: string;
      reportType: string;
      periodStart: string;
      periodEnd: string;
      payload: DailyReportPayload | CorrectionsReportPayload;
      createdAt: string;
    }>
  > {
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
      payload: row.payload as unknown as DailyReportPayload | CorrectionsReportPayload,
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
