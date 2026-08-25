import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { cleanProductName, normalizeProductNameKey } from "@/lib/utils/normalize-product-name";

/**
 * AnalyticsService — KPI queries, product-performance ranking. See
 * docs/11-analytics-reports.md.
 *
 * The analytics.past_dates/date_range/view_all/products permission checks
 * happen HERE, at the query-parameter level (via `AnalyticsPermissions`),
 * not purely in RLS -- "this permission only applies to date ranges the
 * caller explicitly requests" isn't cleanly expressible as a row-level
 * policy. RLS (sales_select, migration 0005) still separately enforces
 * tenant isolation and the sales.view_own/view_all split underneath every
 * query here regardless -- this service's own `viewAll` gate is stricter
 * and independent of that (a Supervisor can hold sales.view_all for the
 * Sales History list while still only holding analytics.view_own for the
 * dashboard -- two different, deliberately separate grants).
 *
 * Product performance groups by product_id using the CURRENT catalog
 * name/image (a live join to `products`), NOT each sale's own
 * product_name_snapshot -- see docs/08-sales-engine.md's snapshot-vs-
 * current decision log. A renamed product's history still shows its old
 * name in Sales History, but rolls up under its current name here.
 *
 * Exception: the system "Others" product (Product Enhancements #2) is
 * never grouped by product_id -- every "Others" sale carries the
 * manually-typed name as its own product_name_snapshot, so those sales
 * are broken back out and grouped by that name instead (normalized via
 * normalizeProductNameKey so case/whitespace variants of the same typed
 * name collapse together), each becoming its own synthetic entry. The
 * literal "Others" catalog row itself never appears in any result here.
 *
 * Aggregation happens in application code after a bounded raw-row fetch,
 * the same pattern BusinessDayService.closeDay already uses for daily
 * aggregates -- consistent with the rest of the codebase rather than
 * introducing a new SQL aggregation function for this first Phase 3
 * increment.
 */
export interface AnalyticsPermissions {
  viewAll: boolean;
  pastDates: boolean;
  dateRange: boolean;
  products: boolean;
  allUsers: boolean;
}

export interface DateRangeInput {
  from: string;
  to: string;
}

export interface Kpis {
  totalSales: number;
  transactionCount: number;
  averageSale: number;
  highestSale: number;
  lowestSale: number;
  productsSoldCount: number;
  activeSalesUsersCount: number | null;
}

export interface ProductPerformanceItem {
  productId: string;
  name: string;
  imageUrl: string | null;
  status: string;
  totalRevenue: number;
  saleCount: number;
}

export type PerformanceTier = "gold" | "silver" | "bronze";
const TIER_ORDER: PerformanceTier[] = ["gold", "silver", "bronze"];

export interface UserPerformanceItem {
  profileId: string;
  name: string;
  totalRevenue: number;
  saleCount: number;
  tier: PerformanceTier | null;
}

export interface DailyTrendPoint {
  date: string;
  totalSales: number;
  transactionCount: number;
}

export class AnalyticsService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * Throws if the requested range needs a permission the caller doesn't
   * hold, rather than silently clamping to "today" -- a caller
   * constructing the range itself (e.g. from a URL param) should get a
   * clear rejection, not quietly-wrong data.
   */
  private assertRangeAllowed(range: DateRangeInput, timezoneToday: string, perms: AnalyticsPermissions) {
    const isToday = range.from === timezoneToday && range.to === timezoneToday;
    if (isToday) return;

    if (!perms.pastDates) {
      throw new Error("AnalyticsService: missing analytics.past_dates for a non-today range");
    }
    if (range.from !== range.to && !perms.dateRange) {
      throw new Error("AnalyticsService: missing analytics.date_range for a multi-day range");
    }
  }

  private async fetchSales(
    tenantId: string,
    range: DateRangeInput,
    timezoneToday: string,
    perms: AnalyticsPermissions,
    currentUserId: string
  ) {
    this.assertRangeAllowed(range, timezoneToday, perms);

    // Excludes 'voided' (removed, no replacement) AND 'corrected' (a
    // corrected sale's ORIGINAL amount is stale -- the real figure lives
    // on its replacement row, already 'open' and already included; a
    // real double-counting bug fixed alongside migration 0026's REVERSE
    // work). 'reversed' is deliberately NOT excluded -- unlike a
    // correction, a reversed original's amount is still real, exactly
    // offset by its new negative row, so both need to keep counting for
    // the pair to correctly net to zero.
    let query = this.supabase
      .from("sales")
      .select("product_id, actual_amount, recorded_by, product_name_snapshot, sale_date")
      .eq("tenant_id", tenantId)
      .gte("sale_date", range.from)
      .lte("sale_date", range.to)
      .neq("status", "voided")
      .neq("status", "corrected");

    if (!perms.viewAll) {
      query = query.eq("recorded_by", currentUserId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`AnalyticsService: ${error.message}`);
    }
    return data ?? [];
  }

  private async getSystemProductId(tenantId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from("products")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_system", true)
      .maybeSingle();
    return data?.id ?? null;
  }

  async getKpis(
    tenantId: string,
    range: DateRangeInput,
    timezoneToday: string,
    perms: AnalyticsPermissions,
    currentUserId: string
  ): Promise<Kpis> {
    const sales = await this.fetchSales(tenantId, range, timezoneToday, perms, currentUserId);

    if (sales.length === 0) {
      return {
        totalSales: 0,
        transactionCount: 0,
        averageSale: 0,
        highestSale: 0,
        lowestSale: 0,
        productsSoldCount: 0,
        activeSalesUsersCount: perms.allUsers ? 0 : null,
      };
    }

    const amounts = sales.map((s) => Number(s.actual_amount));
    const totalSales = amounts.reduce((sum, a) => sum + a, 0);
    const systemProductId = await this.getSystemProductId(tenantId);

    // An "Others" sale doesn't count as the literal system product --
    // each distinct (normalized) manually-typed name counts as its own
    // product instead, same substitution getProductPerformance below
    // makes for the ranked list.
    const distinctProducts = new Set(
      sales.map((s) =>
        systemProductId && s.product_id === systemProductId
          ? `other:${normalizeProductNameKey(s.product_name_snapshot)}`
          : `id:${s.product_id}`
      )
    );

    return {
      totalSales,
      transactionCount: sales.length,
      averageSale: totalSales / sales.length,
      highestSale: Math.max(...amounts),
      lowestSale: Math.min(...amounts),
      productsSoldCount: distinctProducts.size,
      activeSalesUsersCount: perms.allUsers
        ? new Set(sales.map((s) => s.recorded_by)).size
        : null,
    };
  }

  /**
   * Day-by-day bucketing of the same range getKpis aggregates as one
   * total -- the data source for the Analytics page's sales-trend chart
   * (Product Enhancements #1). Sorted ascending by date so a trend chart
   * can plot it directly with no client-side re-sort.
   */
  async getDailyTrend(
    tenantId: string,
    range: DateRangeInput,
    timezoneToday: string,
    perms: AnalyticsPermissions,
    currentUserId: string
  ): Promise<DailyTrendPoint[]> {
    const sales = await this.fetchSales(tenantId, range, timezoneToday, perms, currentUserId);

    const byDate = new Map<string, { totalSales: number; transactionCount: number }>();
    for (const sale of sales) {
      const entry = byDate.get(sale.sale_date) ?? { totalSales: 0, transactionCount: 0 };
      entry.totalSales += Number(sale.actual_amount);
      entry.transactionCount += 1;
      byDate.set(sale.sale_date, entry);
    }

    return [...byDate.entries()]
      .map(([date, agg]) => ({ date, ...agg }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async getProductPerformance(
    tenantId: string,
    range: DateRangeInput,
    timezoneToday: string,
    perms: AnalyticsPermissions,
    currentUserId: string,
    limit = 10
  ): Promise<ProductPerformanceItem[]> {
    if (!perms.products) {
      throw new Error("AnalyticsService.getProductPerformance: missing analytics.products");
    }

    const sales = await this.fetchSales(tenantId, range, timezoneToday, perms, currentUserId);
    if (sales.length === 0) return [];

    const systemProductId = await this.getSystemProductId(tenantId);

    const byProduct = new Map<string, { revenue: number; count: number }>();
    const byOthersName = new Map<string, { revenue: number; count: number; displayName: string }>();

    for (const sale of sales) {
      if (systemProductId && sale.product_id === systemProductId) {
        const key = normalizeProductNameKey(sale.product_name_snapshot);
        const entry = byOthersName.get(key) ?? {
          revenue: 0,
          count: 0,
          displayName: cleanProductName(sale.product_name_snapshot),
        };
        entry.revenue += Number(sale.actual_amount);
        entry.count += 1;
        byOthersName.set(key, entry);
        continue;
      }

      const entry = byProduct.get(sale.product_id) ?? { revenue: 0, count: 0 };
      entry.revenue += Number(sale.actual_amount);
      entry.count += 1;
      byProduct.set(sale.product_id, entry);
    }

    const productIds = [...byProduct.keys()];
    const { data: products, error } =
      productIds.length > 0
        ? await this.supabase
            .from("products")
            .select("id, name, image_url, status")
            .eq("tenant_id", tenantId)
            .in("id", productIds)
        : { data: [], error: null };

    if (error) {
      throw new Error(`AnalyticsService.getProductPerformance: ${error.message}`);
    }

    const productById = new Map((products ?? []).map((p) => [p.id, p]));

    const catalogItems: ProductPerformanceItem[] = [...byProduct.entries()].map(([productId, agg]) => {
      const product = productById.get(productId);
      return {
        productId,
        name: product?.name ?? "(deleted product)",
        imageUrl: product?.image_url ?? null,
        status: product?.status ?? "archived",
        totalRevenue: agg.revenue,
        saleCount: agg.count,
      };
    });

    // Synthetic entries -- not real catalog rows, so productId/status are
    // placeholders (unused by the one consumer, ProductPerformanceList,
    // beyond productId as a React key).
    const othersItems: ProductPerformanceItem[] = [...byOthersName.entries()].map(([key, agg]) => ({
      productId: `other:${key}`,
      name: agg.displayName,
      imageUrl: null,
      status: "active",
      totalRevenue: agg.revenue,
      saleCount: agg.count,
    }));

    return [...catalogItems, ...othersItems]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);
  }

  /**
   * Ranks sales agents/employees by revenue for the period, the same
   * Gold/Silver/Bronze concept getProductPerformance's own consumer
   * (product-grid.tsx) already uses for products. Requires BOTH
   * analytics.view_all (to see every user's sales at all -- without it
   * fetchSales silently scopes to just the caller's own rows, which
   * would make a "ranking" meaningless) and analytics.all_users (the
   * permission specifically for seeing sales broken down by who
   * recorded them, previously only used to gate the KPI tile's
   * "Active Sales Users" count).
   */
  async getUserPerformance(
    tenantId: string,
    range: DateRangeInput,
    timezoneToday: string,
    perms: AnalyticsPermissions,
    currentUserId: string,
    limit = 10
  ): Promise<UserPerformanceItem[]> {
    if (!perms.allUsers || !perms.viewAll) {
      throw new Error("AnalyticsService.getUserPerformance: missing analytics.all_users or analytics.view_all");
    }

    const sales = await this.fetchSales(tenantId, range, timezoneToday, perms, currentUserId);
    if (sales.length === 0) return [];

    const byUser = new Map<string, { revenue: number; count: number }>();
    for (const sale of sales) {
      const entry = byUser.get(sale.recorded_by) ?? { revenue: 0, count: 0 };
      entry.revenue += Number(sale.actual_amount);
      entry.count += 1;
      byUser.set(sale.recorded_by, entry);
    }

    const profileIds = [...byUser.keys()];
    const { data: profiles, error } = await this.supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", profileIds);

    if (error) {
      throw new Error(`AnalyticsService.getUserPerformance: ${error.message}`);
    }

    const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

    return [...byUser.entries()]
      .map(([profileId, agg]) => {
        const profile = profileById.get(profileId);
        return {
          profileId,
          name: profile?.full_name ?? profile?.email ?? "Unknown",
          totalRevenue: agg.revenue,
          saleCount: agg.count,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit)
      .map((item, index) => ({ ...item, tier: TIER_ORDER[index] ?? null }));
  }

  /**
   * Unlike getProductPerformance above, this is tenant-wide by design and
   * NOT permission-gated -- the Capture Sales landing page shows product-
   * performance ranking (Gold/Silver/Bronze) to every user who can record
   * a sale, regardless of whether they hold analytics.products. One query
   * pass covers both windows since "today" is always a subset of the
   * wider window passed in.
   */
  async getProductRevenueTotals(
    tenantId: string,
    windowRange: DateRangeInput,
    todayDate: string
  ): Promise<{ windowRevenue: Map<string, number>; todayRevenue: Map<string, number> }> {
    const systemProductId = await this.getSystemProductId(tenantId);

    let query = this.supabase
      .from("sales")
      .select("product_id, actual_amount, sale_date")
      .eq("tenant_id", tenantId)
      .gte("sale_date", windowRange.from)
      .lte("sale_date", windowRange.to)
      .neq("status", "voided")
      .neq("status", "corrected");

    // The "Others" system product is never a rankable catalog product
    // (Product Enhancements #2) -- exclude it here so it never earns a
    // Gold/Silver/Bronze tier or a "revenue today" line on the Record
    // Sale grid (both driven off this map, see rankProducts/ProductGrid).
    if (systemProductId) {
      query = query.neq("product_id", systemProductId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`AnalyticsService.getProductRevenueTotals: ${error.message}`);
    }

    const windowRevenue = new Map<string, number>();
    const todayRevenue = new Map<string, number>();

    for (const sale of data ?? []) {
      const amount = Number(sale.actual_amount);
      windowRevenue.set(sale.product_id, (windowRevenue.get(sale.product_id) ?? 0) + amount);
      if (sale.sale_date === todayDate) {
        todayRevenue.set(sale.product_id, (todayRevenue.get(sale.product_id) ?? 0) + amount);
      }
    }

    return { windowRevenue, todayRevenue };
  }
}
