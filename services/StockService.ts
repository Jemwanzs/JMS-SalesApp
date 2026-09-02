import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * StockService — the stock ledger (migration 0035). See that migration's
 * header comment for the schema's design decisions (immutable, signed
 * quantity, snapshot columns).
 *
 * `reconciliation_variance` is deliberately NOT a valid input to
 * recordMovement -- that movement type is written only by Phase 7's
 * record_stock_reconciliation() SQL function, atomically alongside the
 * stock_reconciliations row it belongs to (RLS also gates it on
 * `stock.reconcile`, a different permission from every other movement
 * type here). Writing it through this generic path could create a
 * variance movement with no matching reconciliation row.
 */
export type RecordableMovementType =
  | "opening_stock"
  | "stock_in"
  | "stock_out"
  | "adjustment_increase"
  | "adjustment_decrease"
  | "damaged"
  | "expired"
  | "lost";

const INCREASES_BALANCE: ReadonlySet<RecordableMovementType> = new Set(["opening_stock", "stock_in", "adjustment_increase"]);

export interface RecordMovementInput {
  productId: string;
  locationId?: string | null;
  movementType: RecordableMovementType;
  /** Always a positive magnitude -- the sign is derived from movementType, never supplied by the caller. */
  quantity: number;
  reason?: string | null;
  recordedBy: string;
  /**
   * Business Day Rollover: the caller resolves this via
   * BusinessDayService.getEffectiveBusinessDate() (features/stock/actions/
   * record-movement.ts) rather than leaving it to `occurred_on`'s own
   * `default current_date` -- that default is the DATABASE SERVER's
   * calendar date, neither tenant-timezone- nor business-day-aware,
   * exactly the same class of bug sale_date used to avoid by always
   * being set explicitly from the resolved business day. Required, not
   * optional, so this can never silently fall back to that DB default.
   */
  occurredOn: string;
}

export interface StockMovementRow {
  id: string;
  productId: string;
  locationId: string | null;
  movementType: string;
  quantity: number;
  reason: string | null;
  recordedBy: string;
  occurredOn: string;
  createdAt: string;
}

export interface StockBalanceRow {
  productId: string;
  productName: string;
  imageUrl: string | null;
  unitOfMeasure: string | null;
  locationId: string | null;
  balance: number;
  lowStockThreshold: number | null;
}

export interface ReconciliationPreview {
  opening: number;
  stockIn: number;
  stockOut: number;
  expectedClosing: number;
}

export interface StockReconciliationRow {
  id: string;
  productId: string;
  reconciliationDate: string;
  openingQuantity: number;
  stockInQuantity: number;
  stockOutQuantity: number;
  expectedClosingQuantity: number;
  actualQuantity: number;
  variance: number;
  varianceReason: string | null;
  recordedBy: string;
  createdAt: string;
}

export interface DateRangeInput {
  from: string;
  to: string;
}

export interface DailyMovementPoint {
  date: string;
  stockIn: number;
  stockOut: number;
}

export interface VarianceReportRow {
  reconciliationId: string;
  productId: string;
  productName: string;
  unitOfMeasure: string | null;
  reconciliationDate: string;
  expectedClosingQuantity: number;
  actualQuantity: number;
  variance: number;
  varianceReason: string | null;
}

export class StockService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async recordMovement(tenantId: string, input: RecordMovementInput): Promise<void> {
    if (input.quantity <= 0) {
      throw new Error("StockService.recordMovement: quantity must be a positive magnitude");
    }

    const { data: product, error: productError } = await this.supabase
      .from("products")
      .select("name, unit_of_measure, is_system")
      .eq("tenant_id", tenantId)
      .eq("id", input.productId)
      .single();

    if (productError || !product) {
      throw new Error(`StockService.recordMovement: ${productError?.message ?? "product not found"}`);
    }
    if (product.is_system) {
      throw new Error("The system catch-all product doesn't carry stock -- pick a real product.");
    }

    const signedQuantity = INCREASES_BALANCE.has(input.movementType) ? input.quantity : -input.quantity;

    const { error } = await this.supabase.from("stock_movements").insert({
      tenant_id: tenantId,
      location_id: input.locationId ?? null,
      product_id: input.productId,
      product_name_snapshot: product.name,
      unit_of_measure_snapshot: product.unit_of_measure ?? "units",
      movement_type: input.movementType,
      quantity: signedQuantity,
      reason: input.reason ?? null,
      reference_type: "manual",
      recorded_by: input.recordedBy,
      occurred_on: input.occurredOn,
    });

    if (error) {
      throw new Error(`StockService.recordMovement: ${error.message}`);
    }
  }

  async getBalance(tenantId: string, productId: string, locationId?: string | null): Promise<number> {
    let query = this.supabase.from("stock_balances").select("balance").eq("tenant_id", tenantId).eq("product_id", productId);
    query = locationId ? query.eq("location_id", locationId) : query.is("location_id", null);

    const { data } = await query.maybeSingle();
    return data ? Number(data.balance) : 0;
  }

  /** Every tracked product, joined against its current balance (0 for a product with no movements yet). */
  async listBalances(tenantId: string): Promise<StockBalanceRow[]> {
    const { data: products, error: productsError } = await this.supabase
      .from("products")
      .select("id, name, image_url, unit_of_measure, low_stock_threshold")
      .eq("tenant_id", tenantId)
      .eq("tracks_inventory", true)
      .eq("status", "active");

    if (productsError) {
      throw new Error(`StockService.listBalances: ${productsError.message}`);
    }
    if (!products || products.length === 0) return [];

    const { data: balances, error: balancesError } = await this.supabase
      .from("stock_balances")
      .select("product_id, location_id, balance")
      .eq("tenant_id", tenantId)
      .in(
        "product_id",
        products.map((p) => p.id)
      );

    if (balancesError) {
      throw new Error(`StockService.listBalances: ${balancesError.message}`);
    }

    const balanceByProduct = new Map<string, number>();
    for (const row of balances ?? []) {
      balanceByProduct.set(row.product_id, (balanceByProduct.get(row.product_id) ?? 0) + Number(row.balance));
    }

    return products.map((p) => ({
      productId: p.id,
      productName: p.name,
      imageUrl: p.image_url,
      unitOfMeasure: p.unit_of_measure,
      locationId: null,
      balance: balanceByProduct.get(p.id) ?? 0,
      lowStockThreshold: p.low_stock_threshold,
    }));
  }

  async listMovementHistory(tenantId: string, productId: string, limit = 50): Promise<StockMovementRow[]> {
    const { data, error } = await this.supabase
      .from("stock_movements")
      .select("id, product_id, location_id, movement_type, quantity, reason, recorded_by, occurred_on, created_at")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`StockService.listMovementHistory: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      productId: row.product_id,
      locationId: row.location_id,
      movementType: row.movement_type,
      quantity: Number(row.quantity),
      reason: row.reason,
      recordedBy: row.recorded_by,
      occurredOn: row.occurred_on,
      createdAt: row.created_at,
    }));
  }

  async listLowStock(tenantId: string): Promise<StockBalanceRow[]> {
    const balances = await this.listBalances(tenantId);
    return balances.filter((b) => b.lowStockThreshold !== null && b.balance <= b.lowStockThreshold);
  }

  /**
   * Read-only preview of what record_stock_reconciliation() will compute
   * server-side -- lets the reconciliation form show opening/in/out/
   * expected live, before the tenant commits to an actual count.
   * Deliberately duplicates that SQL function's own opening/in/out
   * arithmetic in TypeScript rather than sharing code across languages;
   * the RPC stays the sole source of truth for the WRITE, this is only
   * ever used for display.
   */
  async getReconciliationPreview(tenantId: string, productId: string, date: string): Promise<ReconciliationPreview> {
    const { data, error } = await this.supabase
      .from("stock_movements")
      .select("quantity, occurred_on")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .lte("occurred_on", date);

    if (error) {
      throw new Error(`StockService.getReconciliationPreview: ${error.message}`);
    }

    let opening = 0;
    let stockIn = 0;
    let stockOut = 0;
    for (const row of data ?? []) {
      const qty = Number(row.quantity);
      if (row.occurred_on < date) {
        opening += qty;
      } else if (qty > 0) {
        stockIn += qty;
      } else {
        stockOut += -qty;
      }
    }

    return { opening, stockIn, stockOut, expectedClosing: opening + stockIn - stockOut };
  }

  async submitReconciliation(
    tenantId: string,
    input: { productId: string; locationId?: string | null; date: string; actualQuantity: number; varianceReason?: string | null }
  ): Promise<StockReconciliationRow> {
    const { data, error } = await this.supabase.rpc("record_stock_reconciliation", {
      p_tenant_id: tenantId,
      p_product_id: input.productId,
      p_location_id: input.locationId ?? null,
      p_reconciliation_date: input.date,
      p_actual_quantity: input.actualQuantity,
      p_variance_reason: input.varianceReason ?? null,
    });

    if (error || !data) {
      throw new Error(`StockService.submitReconciliation: ${error?.message ?? "no row returned"}`);
    }

    return {
      id: data.id,
      productId: data.product_id,
      reconciliationDate: data.reconciliation_date,
      openingQuantity: Number(data.opening_quantity),
      stockInQuantity: Number(data.stock_in_quantity),
      stockOutQuantity: Number(data.stock_out_quantity),
      expectedClosingQuantity: Number(data.expected_closing_quantity),
      actualQuantity: Number(data.actual_quantity),
      variance: Number(data.variance),
      varianceReason: data.variance_reason,
      recordedBy: data.recorded_by,
      createdAt: data.created_at,
    };
  }

  /** Every tracked product with no stock_reconciliations row yet for `date` -- the reconcile page's "needs today's count" list. */
  async listPendingReconciliation(tenantId: string, date: string): Promise<StockBalanceRow[]> {
    const [balances, { data: doneRows, error }] = await Promise.all([
      this.listBalances(tenantId),
      this.supabase.from("stock_reconciliations").select("product_id").eq("tenant_id", tenantId).eq("reconciliation_date", date),
    ]);

    if (error) {
      throw new Error(`StockService.listPendingReconciliation: ${error.message}`);
    }

    const doneProductIds = new Set((doneRows ?? []).map((r) => r.product_id));
    return balances.filter((b) => !doneProductIds.has(b.productId));
  }

  /**
   * Day-bucketed stock-in vs stock-out (Product Enhancements #8) -- same
   * bucketing approach as AnalyticsService.getDailyTrend, tenant-wide and
   * not permission-gated internally (the caller/page gates on
   * inventory.view), same reasoning AnalyticsService.getProductRevenueTotals
   * already uses for a tenant-wide read.
   */
  async getMovementTrend(tenantId: string, range: DateRangeInput): Promise<DailyMovementPoint[]> {
    const { data, error } = await this.supabase
      .from("stock_movements")
      .select("quantity, occurred_on")
      .eq("tenant_id", tenantId)
      .gte("occurred_on", range.from)
      .lte("occurred_on", range.to);

    if (error) {
      throw new Error(`StockService.getMovementTrend: ${error.message}`);
    }

    const byDate = new Map<string, { stockIn: number; stockOut: number }>();
    for (const row of data ?? []) {
      const qty = Number(row.quantity);
      const entry = byDate.get(row.occurred_on) ?? { stockIn: 0, stockOut: 0 };
      if (qty > 0) entry.stockIn += qty;
      else entry.stockOut += -qty;
      byDate.set(row.occurred_on, entry);
    }

    return [...byDate.entries()]
      .map(([date, agg]) => ({ date, ...agg }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Reconciliations with a real variance in range, biggest discrepancy first -- the actionable list. */
  async getVarianceReport(tenantId: string, range: DateRangeInput): Promise<VarianceReportRow[]> {
    const { data, error } = await this.supabase
      .from("stock_reconciliations")
      .select("id, product_id, reconciliation_date, expected_closing_quantity, actual_quantity, variance, variance_reason")
      .eq("tenant_id", tenantId)
      .gte("reconciliation_date", range.from)
      .lte("reconciliation_date", range.to)
      .neq("variance", 0);

    if (error) {
      throw new Error(`StockService.getVarianceReport: ${error.message}`);
    }
    if (!data || data.length === 0) return [];

    const productIds = [...new Set(data.map((r) => r.product_id))];
    const { data: products, error: productsError } = await this.supabase
      .from("products")
      .select("id, name, unit_of_measure")
      .in("id", productIds);

    if (productsError) {
      throw new Error(`StockService.getVarianceReport: ${productsError.message}`);
    }

    const productById = new Map((products ?? []).map((p) => [p.id, p]));

    return data
      .map((row) => {
        const product = productById.get(row.product_id);
        return {
          reconciliationId: row.id,
          productId: row.product_id,
          productName: product?.name ?? "(deleted product)",
          unitOfMeasure: product?.unit_of_measure ?? null,
          reconciliationDate: row.reconciliation_date,
          expectedClosingQuantity: Number(row.expected_closing_quantity),
          actualQuantity: Number(row.actual_quantity),
          variance: Number(row.variance),
          varianceReason: row.variance_reason,
        };
      })
      .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
  }
}
