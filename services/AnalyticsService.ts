import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

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
      .select("product_id, actual_amount, recorded_by")
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

    return {
      totalSales,
      transactionCount: sales.length,
      averageSale: totalSales / sales.length,
      highestSale: Math.max(...amounts),
      lowestSale: Math.min(...amounts),
      productsSoldCount: new Set(sales.map((s) => s.product_id)).size,
      activeSalesUsersCount: perms.allUsers
        ? new Set(sales.map((s) => s.recorded_by)).size
        : null,
    };
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

    const byProduct = new Map<string, { revenue: number; count: number }>();
    for (const sale of sales) {
      const entry = byProduct.get(sale.product_id) ?? { revenue: 0, count: 0 };
      entry.revenue += Number(sale.actual_amount);
      entry.count += 1;
      byProduct.set(sale.product_id, entry);
    }

    const productIds = [...byProduct.keys()];
    const { data: products, error } = await this.supabase
      .from("products")
      .select("id, name, image_url, status")
      .in("id", productIds);

    if (error) {
      throw new Error(`AnalyticsService.getProductPerformance: ${error.message}`);
    }

    const productById = new Map((products ?? []).map((p) => [p.id, p]));

    return [...byProduct.entries()]
      .map(([productId, agg]) => {
        const product = productById.get(productId);
        return {
          productId,
          name: product?.name ?? "(deleted product)",
          imageUrl: product?.image_url ?? null,
          status: product?.status ?? "archived",
          totalRevenue: agg.revenue,
          saleCount: agg.count,
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);
  }
}
