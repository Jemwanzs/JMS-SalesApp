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
  openingValue: number;
  addedValue: number;
  expectedSalesValue: number;
}

export type ReconciliationStatus = "balanced" | "within_tolerance" | "variance" | "material_variance";

export interface StockReconciliationRow {
  id: string;
  productId: string;
  reconciliationDate: string;
  openingQuantity: number;
  stockInQuantity: number;
  stockOutQuantity: number;
  expectedClosingQuantity: number;
  actualQuantity: number | null;
  variance: number | null;
  varianceReason: string | null;
  recordedBy: string;
  createdAt: string;
  openingValue: number | null;
  stockAddedValue: number | null;
  expectedSalesValue: number | null;
  actualRecordedSales: number | null;
  actualRemainingValue: number | null;
  validAdjustmentsValue: number;
  unexplainedVarianceValue: number | null;
  status: ReconciliationStatus | null;
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

export interface StockOverviewSummary {
  productsTracked: number;
  currentStockUnits: number;
  stockValue: number;
  expectedSalesValue: number;
  lowStockCount: number;
  outOfStockCount: number;
  stockAddedValue: number;
  stockSoldValue: number;
  damagedLostAdjustedValue: number;
  actualSalesValue: number;
  stockVarianceValue: number;
}

export interface StockHistoryEntry {
  id: string;
  productId: string;
  productName: string;
  unitOfMeasure: string | null;
  movementType: string;
  quantity: number;
  reason: string | null;
  recordedBy: string;
  occurredOn: string;
  createdAt: string;
}

export class StockService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async recordMovement(tenantId: string, input: RecordMovementInput): Promise<void> {
    if (input.quantity <= 0) {
      throw new Error("StockService.recordMovement: quantity must be a positive magnitude");
    }

    const { data: product, error: productError } = await this.supabase
      .from("products")
      .select("name, unit_of_measure, is_system, cost_price, expected_price")
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
      // Snapshotted at the moment of the movement, never re-derived from
      // the product's live price later -- see migration 0067's header
      // comment on why reconciliation/reporting must stay snapshot-safe.
      unit_cost_snapshot: product.cost_price,
      unit_price_snapshot: product.expected_price,
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
      .select("quantity, occurred_on, unit_price_snapshot")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .lte("occurred_on", date);

    if (error) {
      throw new Error(`StockService.getReconciliationPreview: ${error.message}`);
    }

    let opening = 0;
    let stockIn = 0;
    let stockOut = 0;
    let openingValue = 0;
    let addedValue = 0;
    for (const row of data ?? []) {
      const qty = Number(row.quantity);
      const priceBasis = row.unit_price_snapshot !== null ? Number(row.unit_price_snapshot) : 0;
      if (row.occurred_on < date) {
        opening += qty;
        openingValue += qty * priceBasis;
      } else if (qty > 0) {
        stockIn += qty;
        addedValue += qty * priceBasis;
      } else {
        stockOut += -qty;
      }
    }

    return {
      opening,
      stockIn,
      stockOut,
      expectedClosing: opening + stockIn - stockOut,
      openingValue,
      addedValue,
      expectedSalesValue: openingValue + addedValue,
    };
  }

  /** Real recorded revenue for a product on a single date -- the "Actual Recorded Sales" side of a value-based reconciliation. Excludes voided/corrected originals, same convention every other gross-sales aggregate in this app follows. */
  async getActualRecordedSales(tenantId: string, productId: string, date: string): Promise<number> {
    const { data, error } = await this.supabase
      .from("sales")
      .select("actual_amount")
      .eq("tenant_id", tenantId)
      .eq("product_id", productId)
      .eq("sale_date", date)
      .neq("status", "voided")
      .neq("status", "corrected");

    if (error) {
      throw new Error(`StockService.getActualRecordedSales: ${error.message}`);
    }

    return (data ?? []).reduce((sum, row) => sum + Number(row.actual_amount), 0);
  }

  async submitReconciliation(
    tenantId: string,
    input: {
      productId: string;
      locationId?: string | null;
      date: string;
      /** Required for a quantity-controlled product; the RPC itself rejects null there. Left null for a value-controlled product -- see migration 0068. */
      actualQuantity?: number | null;
      varianceReason?: string | null;
      /** Value-based control only -- ignored (left null server-side) for a quantity-based product. */
      actualRecordedSales?: number | null;
      actualRemainingValue?: number | null;
      validAdjustmentsValue?: number | null;
    }
  ): Promise<StockReconciliationRow> {
    const { data, error } = await this.supabase.rpc("record_stock_reconciliation", {
      p_tenant_id: tenantId,
      p_product_id: input.productId,
      p_location_id: input.locationId ?? null,
      p_reconciliation_date: input.date,
      p_actual_quantity: input.actualQuantity ?? null,
      p_variance_reason: input.varianceReason ?? null,
      p_actual_recorded_sales: input.actualRecordedSales ?? null,
      p_actual_remaining_value: input.actualRemainingValue ?? null,
      p_valid_adjustments_value: input.validAdjustmentsValue ?? 0,
    });

    if (error || !data) {
      throw new Error(`StockService.submitReconciliation: ${error?.message ?? "no row returned"}`);
    }

    return toReconciliationRow(data);
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

  /**
   * The Overview tab's summary cards. Stock value/expected sales value
   * are current-balance snapshots (not range-bound -- "what do I have
   * right now"); everything else is bucketed to `range` (what moved
   * during that window). All monetary figures read straight off each
   * movement's OWN unit_cost_snapshot/unit_price_snapshot (migration
   * 0067) -- never the product's live price -- so a price change
   * partway through the range can't retroactively skew it.
   */
  async getOverviewSummary(tenantId: string, range: DateRangeInput): Promise<StockOverviewSummary> {
    const { data: products, error: productsError } = await this.supabase
      .from("products")
      .select("id, cost_price, expected_price, low_stock_threshold")
      .eq("tenant_id", tenantId)
      .eq("tracks_inventory", true)
      .eq("status", "active");

    if (productsError) {
      throw new Error(`StockService.getOverviewSummary: ${productsError.message}`);
    }

    const productIds = (products ?? []).map((p) => p.id);
    if (productIds.length === 0) {
      return {
        productsTracked: 0,
        currentStockUnits: 0,
        stockValue: 0,
        expectedSalesValue: 0,
        lowStockCount: 0,
        outOfStockCount: 0,
        stockAddedValue: 0,
        stockSoldValue: 0,
        damagedLostAdjustedValue: 0,
        actualSalesValue: 0,
        stockVarianceValue: 0,
      };
    }

    const productById = new Map((products ?? []).map((p) => [p.id, p]));

    const { data: balances, error: balancesError } = await this.supabase
      .from("stock_balances")
      .select("product_id, balance")
      .eq("tenant_id", tenantId)
      .in("product_id", productIds);

    if (balancesError) {
      throw new Error(`StockService.getOverviewSummary: ${balancesError.message}`);
    }

    const balanceByProduct = new Map<string, number>();
    for (const row of balances ?? []) {
      balanceByProduct.set(row.product_id, (balanceByProduct.get(row.product_id) ?? 0) + Number(row.balance));
    }

    let currentStockUnits = 0;
    let stockValue = 0;
    let expectedSalesValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const p of products ?? []) {
      const balance = balanceByProduct.get(p.id) ?? 0;
      currentStockUnits += balance;
      stockValue += balance * (p.cost_price ?? 0);
      expectedSalesValue += balance * (p.expected_price ?? 0);
      if (balance <= 0) outOfStockCount += 1;
      else if (p.low_stock_threshold !== null && balance <= p.low_stock_threshold) lowStockCount += 1;
    }

    const { data: movements, error: movementsError } = await this.supabase
      .from("stock_movements")
      .select("product_id, movement_type, quantity, unit_cost_snapshot, unit_price_snapshot")
      .eq("tenant_id", tenantId)
      .in("product_id", productIds)
      .gte("occurred_on", range.from)
      .lte("occurred_on", range.to);

    if (movementsError) {
      throw new Error(`StockService.getOverviewSummary: ${movementsError.message}`);
    }

    let stockAddedValue = 0;
    let stockSoldValue = 0;
    let damagedLostAdjustedValue = 0;

    for (const m of movements ?? []) {
      const qty = Number(m.quantity);
      const costBasis = m.unit_cost_snapshot !== null ? Number(m.unit_cost_snapshot) : 0;
      const priceBasis = m.unit_price_snapshot !== null ? Number(m.unit_price_snapshot) : 0;

      if (m.movement_type === "opening_stock" || m.movement_type === "stock_in") {
        stockAddedValue += qty * costBasis;
      } else if (m.movement_type === "sale" || m.movement_type === "stock_out") {
        stockSoldValue += Math.abs(qty) * priceBasis;
      } else if (["damaged", "expired", "lost", "adjustment_decrease"].includes(m.movement_type)) {
        damagedLostAdjustedValue += Math.abs(qty) * costBasis;
      }
    }

    const { data: sales, error: salesError } = await this.supabase
      .from("sales")
      .select("actual_amount")
      .eq("tenant_id", tenantId)
      .in("product_id", productIds)
      .neq("status", "voided")
      .neq("status", "corrected")
      .gte("sale_date", range.from)
      .lte("sale_date", range.to);

    if (salesError) {
      throw new Error(`StockService.getOverviewSummary: ${salesError.message}`);
    }

    const actualSalesValue = (sales ?? []).reduce((sum, s) => sum + Number(s.actual_amount), 0);

    const { data: reconciliations, error: reconciliationsError } = await this.supabase
      .from("stock_reconciliations")
      .select("product_id, variance, unexplained_variance_value")
      .eq("tenant_id", tenantId)
      .in("product_id", productIds)
      .gte("reconciliation_date", range.from)
      .lte("reconciliation_date", range.to);

    if (reconciliationsError) {
      throw new Error(`StockService.getOverviewSummary: ${reconciliationsError.message}`);
    }

    let stockVarianceValue = 0;
    for (const r of reconciliations ?? []) {
      if (r.unexplained_variance_value !== null) {
        stockVarianceValue += Math.abs(Number(r.unexplained_variance_value));
      } else {
        const product = productById.get(r.product_id);
        stockVarianceValue += Math.abs(Number(r.variance)) * (product?.cost_price ?? 0);
      }
    }

    return {
      productsTracked: productIds.length,
      currentStockUnits,
      stockValue,
      expectedSalesValue,
      lowStockCount,
      outOfStockCount,
      stockAddedValue,
      stockSoldValue,
      damagedLostAdjustedValue,
      actualSalesValue,
      stockVarianceValue,
    };
  }

  /** Tenant-wide movement feed for the History tab -- every tracked product, newest first, optionally filtered. */
  async listHistory(
    tenantId: string,
    opts: { productId?: string; from?: string; to?: string; limit?: number } = {}
  ): Promise<StockHistoryEntry[]> {
    let query = this.supabase
      .from("stock_movements")
      .select("id, product_id, product_name_snapshot, unit_of_measure_snapshot, movement_type, quantity, reason, recorded_by, occurred_on, created_at")
      .eq("tenant_id", tenantId)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(opts.limit ?? 100);

    if (opts.productId) query = query.eq("product_id", opts.productId);
    if (opts.from) query = query.gte("occurred_on", opts.from);
    if (opts.to) query = query.lte("occurred_on", opts.to);

    const { data, error } = await query;

    if (error) {
      throw new Error(`StockService.listHistory: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      productId: row.product_id,
      productName: row.product_name_snapshot,
      unitOfMeasure: row.unit_of_measure_snapshot,
      movementType: row.movement_type,
      quantity: Number(row.quantity),
      reason: row.reason,
      recordedBy: row.recorded_by,
      occurredOn: row.occurred_on,
      createdAt: row.created_at,
    }));
  }
}

function toReconciliationRow(data: Database["public"]["Tables"]["stock_reconciliations"]["Row"]): StockReconciliationRow {
  return {
    id: data.id,
    productId: data.product_id,
    reconciliationDate: data.reconciliation_date,
    openingQuantity: Number(data.opening_quantity),
    stockInQuantity: Number(data.stock_in_quantity),
    stockOutQuantity: Number(data.stock_out_quantity),
    expectedClosingQuantity: Number(data.expected_closing_quantity),
    actualQuantity: data.actual_quantity !== null ? Number(data.actual_quantity) : null,
    variance: data.variance !== null ? Number(data.variance) : null,
    varianceReason: data.variance_reason,
    recordedBy: data.recorded_by,
    createdAt: data.created_at,
    openingValue: data.opening_value !== null ? Number(data.opening_value) : null,
    stockAddedValue: data.stock_added_value !== null ? Number(data.stock_added_value) : null,
    expectedSalesValue: data.expected_sales_value !== null ? Number(data.expected_sales_value) : null,
    actualRecordedSales: data.actual_recorded_sales !== null ? Number(data.actual_recorded_sales) : null,
    actualRemainingValue: data.actual_remaining_value !== null ? Number(data.actual_remaining_value) : null,
    validAdjustmentsValue: Number(data.valid_adjustments_value),
    unexplainedVarianceValue: data.unexplained_variance_value !== null ? Number(data.unexplained_variance_value) : null,
    status: data.status,
  };
}
