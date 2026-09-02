import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { cleanProductName, normalizeProductNameKey } from "@/lib/utils/normalize-product-name";

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

export interface DailySalesSummaryProduct {
  name: string;
  quantity: number | null;
  amount: number;
}

export interface DailySalesSummary {
  totalSalesAmount: number;
  transactionCount: number;
  products: DailySalesSummaryProduct[];
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

  /**
   * `businessDayId`-only lookup, no `tenant_id` filter, is safe ONLY
   * because this is exclusively called via the service-role client from
   * app/api/cron/outbox/route.ts with a businessDayId sourced from
   * report_jobs.payload (DB-internal, never user-supplied) -- a security
   * sweep flagged this as "fragile but currently safe": there is no RLS
   * backstop at all here (service-role bypasses RLS), unlike the
   * equivalent pattern elsewhere in this app. `tenant_id` genuinely
   * isn't known until this query resolves it, so there's no earlier
   * point to filter from. If this method is ever reused from a request-
   * facing route instead of the trusted cron path, it would become a
   * real cross-tenant read -- don't do that without adding an explicit
   * tenant_id check against the caller's own session first.
   */
  async generateDailyReport(businessDayId: string): Promise<string> {
    const { data: businessDay, error: dayError } = await this.supabase
      .from("business_days")
      .select("id, tenant_id, location_id, business_date")
      .eq("id", businessDayId)
      .single();

    if (dayError || !businessDay) {
      throw new Error(`ReportService.generateDailyReport: business day not found`);
    }

    const payload = await this.computeDailyReportPayload(
      businessDay.tenant_id,
      businessDay.location_id,
      businessDay.business_date
    );

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
   * Reports Must Always Be Available (Product Enhancements): the daily
   * sales report used to exist only as a `reports` row written at
   * business-day close (see generateDailyReport above) -- meaning a
   * still-open day had no report at all, not even a zero one, until it
   * closed. This computes the SAME payload shape live, straight from
   * `sales` for the given tenant/location/date, so the Reports page can
   * show today's figures (real or zero) while the day is still open,
   * not just after close.
   *
   * Deliberately queries by tenant_id + location_id + sale_date rather
   * than business_day_id -- unlike generateDailyReport (always called
   * for an already-closed, already-businessDayId-known day), this is
   * called for a date that may not have a business_days row at all yet
   * (never opened today). Extracted as the one shared computation both
   * generateDailyReport and this method use, so a closed day's stored
   * report and an open day's live figures can never drift apart from
   * computing the same numbers two different ways.
   */
  async computeDailyReportPayload(
    tenantId: string,
    locationId: string | null,
    businessDate: string
  ): Promise<DailyReportPayload> {
    // Excludes 'corrected' too -- see AnalyticsService.getAnalytics's
    // own comment on this exact filter.
    let query = this.supabase
      .from("sales")
      .select("product_name_snapshot, actual_amount, recorded_by")
      .eq("tenant_id", tenantId)
      .eq("sale_date", businessDate)
      .neq("status", "voided")
      .neq("status", "corrected");
    if (locationId) {
      query = query.eq("location_id", locationId);
    }
    const { data: sales, error: salesError } = await query;

    if (salesError) {
      throw new Error(`ReportService.computeDailyReportPayload: ${salesError.message}`);
    }

    const grossSales = (sales ?? []).reduce((sum, s) => sum + Number(s.actual_amount), 0);
    const transactionCount = (sales ?? []).length;
    const averageSale = transactionCount > 0 ? grossSales / transactionCount : 0;

    const topProduct = topByNormalizedName(sales ?? []);

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
    if (locationId) {
      const { data: previousDay } = await this.supabase
        .from("business_days")
        .select("aggregates")
        .eq("tenant_id", tenantId)
        .eq("location_id", locationId)
        .eq("status", "closed")
        .lt("business_date", businessDate)
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

    return {
      grossSales,
      transactionCount,
      averageSale,
      topProduct: topProduct ? { name: topProduct.key, revenue: topProduct.revenue } : null,
      topSalesPerson,
      vsPreviousDay,
    };
  }

  /**
   * On-demand Daily Sales Summary for the poster/PDF feature (Product
   * Enhancements #7) -- unlike generateDailyReport above, this reads
   * `sales` directly for the given date rather than through business_
   * days.aggregates (there can be more than one location/business day
   * for a single tenant-wide date), isn't written to the `reports`
   * table, and is triggered synchronously by a user action rather than
   * the cron outbox. Always reflects whatever's in `sales` at the
   * moment it's called, per the spec's own "latest sales records
   * available at the time of generation" wording. Grouped by
   * normalizeProductNameKey so "Others" entries (Product Enhancements
   * #2, free-text names) with only case/whitespace differences roll up
   * into one line instead of several -- same convention as
   * topByNormalizedName above.
   */
  async getDailySalesSummary(tenantId: string, date: string): Promise<DailySalesSummary> {
    const { data, error } = await this.supabase
      .from("sales")
      .select("product_name_snapshot, actual_amount, quantity")
      .eq("tenant_id", tenantId)
      .eq("sale_date", date)
      .neq("status", "voided")
      .neq("status", "corrected");

    if (error) {
      throw new Error(`ReportService.getDailySalesSummary: ${error.message}`);
    }

    const rows = data ?? [];
    const totalSalesAmount = rows.reduce((sum, s) => sum + Number(s.actual_amount), 0);

    const byName = new Map<string, { amount: number; quantity: number | null; displayName: string }>();
    for (const row of rows) {
      const key = normalizeProductNameKey(row.product_name_snapshot);
      const entry = byName.get(key) ?? {
        amount: 0,
        quantity: null,
        displayName: cleanProductName(row.product_name_snapshot),
      };
      entry.amount += Number(row.actual_amount);
      if (row.quantity !== null) {
        entry.quantity = (entry.quantity ?? 0) + Number(row.quantity);
      }
      byName.set(key, entry);
    }

    const products = [...byName.values()]
      .map((p) => ({ name: p.displayName, quantity: p.quantity, amount: p.amount }))
      .sort((a, b) => b.amount - a.amount);

    return { totalSalesAmount, transactionCount: rows.length, products };
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
  // Same businessDayId-only lookup, same "safe only via the trusted cron
  // path" caveat as generateDailyReport above.
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

/**
 * Same shape as topBy above, but groups product_name_snapshot values by
 * normalizeProductNameKey first -- "Sugar" / "sugar " / "Sugar" (the
 * free-text names the "Others" system product produces, Product
 * Enhancements #2) would otherwise be counted as separate products here.
 * `.key` on the result is still the display-facing name (the first
 * cleaned spelling seen for that normalized group), not the raw
 * lowercase grouping key.
 */
function topByNormalizedName(
  rows: { product_name_snapshot: string; actual_amount: number }[]
): { key: string; revenue: number } | null {
  const totals = new Map<string, { revenue: number; displayName: string }>();
  for (const row of rows) {
    const key = normalizeProductNameKey(row.product_name_snapshot);
    const entry = totals.get(key) ?? { revenue: 0, displayName: cleanProductName(row.product_name_snapshot) };
    entry.revenue += Number(row.actual_amount);
    totals.set(key, entry);
  }

  let best: { key: string; revenue: number } | null = null;
  for (const { revenue, displayName } of totals.values()) {
    if (!best || revenue > best.revenue) {
      best = { key: displayName, revenue };
    }
  }
  return best;
}
