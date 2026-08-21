import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * InsightsService — rule-based deterministic insights engine v1 (docs/11-
 * analytics-reports.md). No LLM, no per-tenant inference cost -- three
 * rules evaluated over already-computed `business_days.aggregates` and
 * `sales` rows, written to `insights_snapshots` (migration 0014).
 *
 * Called from the outbox-drain worker (app/api/cron/outbox) right after
 * a `daily_business_day_report` job succeeds -- insights are triggered by
 * the same "a business day just closed" event as the daily report, not a
 * separate schedule.
 *
 * Deliberately deferred (see migration 0014's header): the "same time of
 * day" / Daily Pulse alerts -- explicitly labeled a Phase 3 "stretch" in
 * the spec, not required for this increment.
 *
 * Product concentration uses the CURRENT catalog name (a live join),
 * matching AnalyticsService's convention for arbitrary-range aggregates
 * -- this is a business-wide weekly fact, not a historical record of one
 * specific sale, so it follows 3b's reasoning, not 3c's (see
 * ReportService's header for why those two differ on purpose).
 */
const PRODUCT_SHARE_THRESHOLD = 0.3;
const UNDERPERFORMING_WEEKDAY_RATIO = 0.6;
const WEEKS_OF_HISTORY_FOR_WEEKDAY_RULE = 8;
const MIN_SAMPLES_PER_WEEKDAY = 3;

function toDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(ymd: string, days: number): string {
  return toYmd(new Date(toDate(ymd).getTime() + days * 86_400_000));
}
/** Sunday-start week containing `ymd`, matching location_hours' day_of_week convention. */
function weekBounds(ymd: string): { from: string; to: string } {
  const dow = toDate(ymd).getUTCDay();
  const from = addDays(ymd, -dow);
  return { from, to: addDays(from, 6) };
}

export class InsightsService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  // businessDayId-only lookup, no tenant_id filter -- safe only because
  // this runs via the service-role client from app/api/cron/outbox/
  // route.ts with a DB-internal, never user-supplied businessDayId (same
  // caveat as ReportService.generateDailyReport's own header comment;
  // there's no RLS backstop here at all, unlike the pattern found
  // elsewhere in this app, since service-role bypasses RLS entirely).
  async evaluateDailyInsights(businessDayId: string): Promise<number> {
    const { data: day, error: dayError } = await this.supabase
      .from("business_days")
      .select("id, tenant_id, location_id, business_date")
      .eq("id", businessDayId)
      .single();

    if (dayError || !day) {
      throw new Error("InsightsService.evaluateDailyInsights: business day not found");
    }

    const insights = (
      await Promise.all([
        this.weekOverWeek(day),
        this.productConcentration(day),
        this.recurringLowWeekday(day),
      ])
    ).filter((row): row is NonNullable<typeof row> => row !== null);

    if (insights.length === 0) {
      return 0;
    }

    const { error: insertError } = await this.supabase.from("insights_snapshots").insert(
      insights.map((insight) => ({
        tenant_id: day.tenant_id,
        location_id: day.location_id,
        business_day_id: day.id,
        ...insight,
      }))
    );

    if (insertError) {
      throw new Error(`InsightsService.evaluateDailyInsights: ${insertError.message}`);
    }

    return insights.length;
  }

  private async grossSalesInRange(
    tenantId: string,
    locationId: string,
    from: string,
    to: string
  ): Promise<{ total: number; closedDayCount: number }> {
    const { data, error } = await this.supabase
      .from("business_days")
      .select("aggregates")
      .eq("tenant_id", tenantId)
      .eq("location_id", locationId)
      .eq("status", "closed")
      .gte("business_date", from)
      .lte("business_date", to);

    if (error) {
      throw new Error(`InsightsService: ${error.message}`);
    }

    const rows = data ?? [];
    const total = rows.reduce(
      (sum, row) => sum + ((row.aggregates as { grossSales?: number }).grossSales ?? 0),
      0
    );
    return { total, closedDayCount: rows.length };
  }

  private async weekOverWeek(day: {
    tenant_id: string;
    location_id: string;
    business_date: string;
  }) {
    const current = weekBounds(day.business_date);
    const previous = weekBounds(addDays(current.from, -1));

    const [currentWeek, previousWeek] = await Promise.all([
      this.grossSalesInRange(day.tenant_id, day.location_id, current.from, current.to),
      this.grossSalesInRange(day.tenant_id, day.location_id, previous.from, previous.to),
    ]);

    if (currentWeek.closedDayCount === 0 || previousWeek.total <= 0) {
      return null;
    }

    const changePercent = ((currentWeek.total - previousWeek.total) / previousWeek.total) * 100;
    const increased = changePercent >= 0;

    return {
      rule_key: "week_over_week_change",
      severity: increased ? ("positive" as const) : ("warning" as const),
      message: `Sales ${increased ? "increased" : "decreased"} by ${Math.abs(changePercent).toFixed(1)}% vs. last week`,
      data: { currentWeekTotal: currentWeek.total, previousWeekTotal: previousWeek.total, changePercent },
    };
  }

  private async productConcentration(day: {
    tenant_id: string;
    location_id: string;
    business_date: string;
  }) {
    const { from, to } = weekBounds(day.business_date);

    // The system "Others" product (Product Enhancements #2) isn't a real
    // single product -- lumping every manually-typed sale under it would
    // make it a spurious "top product" regardless of what was actually
    // sold, so it's excluded here rather than eligible to trigger this
    // rule (unlike AnalyticsService.getProductPerformance, this rule has
    // no per-name breakout to fall back to -- a false "X% concentrated"
    // warning naming "Others" would be actively misleading).
    const { data: systemProduct } = await this.supabase
      .from("products")
      .select("id")
      .eq("tenant_id", day.tenant_id)
      .eq("is_system", true)
      .maybeSingle();

    // Excludes 'corrected' too -- see AnalyticsService.getAnalytics's
    // own comment on this exact filter.
    let query = this.supabase
      .from("sales")
      .select("product_id, actual_amount")
      .eq("tenant_id", day.tenant_id)
      .eq("location_id", day.location_id)
      .gte("sale_date", from)
      .lte("sale_date", to)
      .neq("status", "voided")
      .neq("status", "corrected");

    if (systemProduct) {
      query = query.neq("product_id", systemProduct.id);
    }

    const { data: sales, error } = await query;

    if (error) {
      throw new Error(`InsightsService.productConcentration: ${error.message}`);
    }
    if (!sales || sales.length === 0) {
      return null;
    }

    const totals = new Map<string, number>();
    let grandTotal = 0;
    for (const sale of sales) {
      const amount = Number(sale.actual_amount);
      totals.set(sale.product_id, (totals.get(sale.product_id) ?? 0) + amount);
      grandTotal += amount;
    }
    if (grandTotal <= 0) return null;

    let topProductId: string | null = null;
    let topRevenue = 0;
    for (const [productId, revenue] of totals) {
      if (revenue > topRevenue) {
        topProductId = productId;
        topRevenue = revenue;
      }
    }
    const share = topRevenue / grandTotal;
    if (!topProductId || share <= PRODUCT_SHARE_THRESHOLD) {
      return null;
    }

    const { data: product } = await this.supabase
      .from("products")
      .select("name")
      .eq("id", topProductId)
      .eq("tenant_id", day.tenant_id)
      .maybeSingle();
    const name = product?.name ?? "A product";

    return {
      rule_key: "product_concentration",
      severity: "warning" as const,
      message: `${name} represents ${(share * 100).toFixed(0)}% of this week's sales`,
      data: { productId: topProductId, productName: name, share, weekRevenue: grandTotal },
    };
  }

  private async recurringLowWeekday(day: {
    tenant_id: string;
    location_id: string;
    business_date: string;
  }) {
    const from = addDays(day.business_date, -7 * WEEKS_OF_HISTORY_FOR_WEEKDAY_RULE);

    const { data: days, error } = await this.supabase
      .from("business_days")
      .select("business_date, aggregates")
      .eq("tenant_id", day.tenant_id)
      .eq("location_id", day.location_id)
      .eq("status", "closed")
      .gte("business_date", from)
      .lte("business_date", day.business_date);

    if (error) {
      throw new Error(`InsightsService.recurringLowWeekday: ${error.message}`);
    }
    if (!days || days.length < 7) {
      return null;
    }

    const byWeekday = new Map<number, number[]>();
    let overallTotal = 0;
    for (const row of days) {
      const dow = toDate(row.business_date).getUTCDay();
      const gross = (row.aggregates as { grossSales?: number }).grossSales ?? 0;
      byWeekday.set(dow, [...(byWeekday.get(dow) ?? []), gross]);
      overallTotal += gross;
    }
    const overallAverage = overallTotal / days.length;
    if (overallAverage <= 0) return null;

    const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let worst: { dow: number; average: number } | null = null;

    for (const [dow, values] of byWeekday) {
      if (values.length < MIN_SAMPLES_PER_WEEKDAY) continue;
      const average = values.reduce((s, v) => s + v, 0) / values.length;
      if (average < overallAverage * UNDERPERFORMING_WEEKDAY_RATIO) {
        if (!worst || average < worst.average) {
          worst = { dow, average };
        }
      }
    }

    if (!worst) return null;

    const belowPercent = ((overallAverage - worst.average) / overallAverage) * 100;
    return {
      rule_key: "recurring_low_weekday",
      severity: "warning" as const,
      message: `${WEEKDAY_NAMES[worst.dow]}s tend to underperform, averaging ${belowPercent.toFixed(0)}% below other days`,
      data: { weekday: WEEKDAY_NAMES[worst.dow], weekdayAverage: worst.average, overallAverage },
    };
  }

  /**
   * RLS (insights_snapshots_select, migration 0014) already restricts
   * rows to analytics.view_all holders -- no separate check needed here.
   */
  async listRecent(
    tenantId: string,
    limit = 10
  ): Promise<Array<{ id: string; ruleKey: string; severity: "positive" | "warning" | "info"; message: string; generatedAt: string }>> {
    const { data, error } = await this.supabase
      .from("insights_snapshots")
      .select("id, rule_key, severity, message, generated_at")
      .eq("tenant_id", tenantId)
      .order("generated_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`InsightsService.listRecent: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      ruleKey: row.rule_key,
      severity: row.severity,
      message: row.message,
      generatedAt: row.generated_at,
    }));
  }
}
