import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, SaleStatus, VoidOrCorrectResult } from "@/types/database.types";
import { getStockControlMethod } from "@/lib/inventory/stock-control-method";
import { cleanProductName } from "@/lib/utils/normalize-product-name";

/**
 * SalesService — the highest-risk correctness surface in the app. Owns:
 *   - idempotency-key handling (client-generated once per form mount;
 *     ON CONFLICT DO NOTHING + fall back to returning the existing row)
 *   - snapshotting product name/image/expected-price at sale time
 * Sale-number assignment itself lives in the assign_sale_number
 * Postgres trigger (supabase/migrations/0005), not here — see
 * docs/08-sales-engine.md.
 *
 * actual_amount is always the TOTAL charged, not a unit price — quantity
 * is informational only (docs/08-sales-engine.md's decision log).
 *
 * voidSale/correctSale/reverseSale never touch `sales` directly —
 * `sales` still has NO UPDATE/DELETE RLS policy at all (migration 0005's
 * invariant holds). All three delegate to the void_sale/correct_sale/
 * reverse_sale SECURITY DEFINER Postgres functions (migrations 0006/
 * 0026), which enforce permission + edit-window/approval-routing in one
 * place and are the ONLY code path that can ever change a sale's status
 * post-insert. reverseSale() is the third documented mutation type
 * (docs/08-sales-engine.md's "VOID / CORRECT / REVERSE"): an offsetting
 * entry, not a delete or amount-edit — the original flips to 'reversed'
 * and a new sale row is inserted with the negated amount, both staying
 * visible in history and correctly netting to zero in every gross-sales
 * aggregate (which already just sums actual_amount).
 */
export interface RecordSaleInput {
  tenantId: string;
  locationId: string;
  businessDayId: string;
  productId: string;
  actualAmount: number;
  quantity?: number | null;
  notes?: string | null;
  /** Required when productId resolves to the "Others" system product
   * (spec: Product Enhancements #2) -- becomes the sale's own
   * product_name_snapshot instead of the literal "Others" label, so
   * reporting/analytics treat whatever the agent typed as the real
   * product. Ignored for an ordinary catalog product. */
  manualProductName?: string | null;
  recordedBy: string;
  idempotencyKey: string;
}

export interface RecordedSale {
  id: string;
  saleNumber: string | null;
  productNameSnapshot: string;
  actualAmount: number;
  saleTime: string;
  replayed: boolean;
}

export interface SaleListItem {
  id: string;
  saleNumber: string | null;
  productNameSnapshot: string;
  actualAmount: number;
  quantity: number | null;
  status: SaleStatus;
  saleTime: string;
  recordedBy: string;
}

export class SalesService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async recordSale(input: RecordSaleInput): Promise<RecordedSale> {
    const { data: businessDay, error: bdError } = await this.supabase
      .from("business_days")
      .select("id, business_date, status")
      .eq("id", input.businessDayId)
      .single();

    if (bdError || !businessDay) {
      throw new Error(`SalesService.recordSale: business day not found`);
    }

    // "reopened" is a temporary, time-boxed re-open of a closed day
    // (Phase 2h) — sales can be captured during it same as "open"; it
    // auto-relocks to "closed" once its window expires (see
    // BusinessDayService.getTodayBusinessDay).
    if (businessDay.status !== "open" && businessDay.status !== "reopened") {
      throw new Error(
        `SalesService.recordSale: business day is "${businessDay.status}", not open`
      );
    }

    const { data: product, error: productError } = await this.supabase
      .from("products")
      .select("name, image_url, expected_price, is_system, tracks_inventory")
      .eq("id", input.productId)
      .eq("tenant_id", input.tenantId)
      .single();

    if (productError || !product) {
      throw new Error("SalesService.recordSale: product not found");
    }

    const manualName = input.manualProductName ? cleanProductName(input.manualProductName) : "";
    if (product.is_system && !manualName) {
      throw new Error("Enter a product name for this sale.");
    }

    // The tenant's own Settings -> Inventory Configuration -> "Record
    // Stock By" choice, not a per-product setting, decides whether a
    // quantity is mandatory -- and only for a tracked product, since an
    // untracked one has no stock ledger to deduct from either way. The
    // insert trigger (migration 0072) enforces this same rule as a hard
    // backstop against a direct API call bypassing this service.
    if (product.tracks_inventory && (input.quantity === null || input.quantity === undefined || input.quantity === 0)) {
      const method = await getStockControlMethod(this.supabase, input.tenantId);
      if (method === "quantity") {
        throw new Error(`Enter a quantity -- "${product.name}" tracks stock and this tenant records stock by quantity.`);
      }
    }

    // For a value-controlled tenant (the default), stock deduction copes
    // fine without a quantity here -- the insert trigger infers one from
    // the sale amount and the product's own selling price when none is
    // given.

    const { data: inserted, error: insertError } = await this.supabase
      .from("sales")
      .insert({
        tenant_id: input.tenantId,
        location_id: input.locationId,
        business_day_id: input.businessDayId,
        product_id: input.productId,
        product_name_snapshot: product.is_system ? manualName : product.name,
        product_image_snapshot: product.image_url,
        expected_price_snapshot: product.expected_price,
        actual_amount: input.actualAmount,
        quantity: input.quantity ?? null,
        notes: input.notes ?? null,
        recorded_by: input.recordedBy,
        sale_date: businessDay.business_date,
        idempotency_key: input.idempotencyKey,
      })
      .select("id, sale_number, product_name_snapshot, actual_amount, sale_time")
      .maybeSingle();

    if (insertError && !isConflictError(insertError)) {
      throw new Error(`SalesService.recordSale: ${insertError.message}`);
    }

    if (inserted) {
      return { ...toRecordedSale(inserted), replayed: false };
    }

    // Conflict on (tenant_id, idempotency_key): this is a retry of a
    // submission that already succeeded (double-tap, timeout, refresh).
    // Return the existing row as a successful idempotent replay rather
    // than surfacing an error -- the client shouldn't need to
    // distinguish "this was my duplicate" from "this was a genuine
    // retry." See docs/08-sales-engine.md.
    const { data: existing, error: lookupError } = await this.supabase
      .from("sales")
      .select("id, sale_number, product_name_snapshot, actual_amount, sale_time")
      .eq("tenant_id", input.tenantId)
      .eq("idempotency_key", input.idempotencyKey)
      .single();

    if (lookupError || !existing) {
      throw new Error(
        `SalesService.recordSale: idempotent insert conflicted but the existing row could not be found: ${lookupError?.message}`
      );
    }

    return { ...toRecordedSale(existing), replayed: true };
  }

  async voidSale(saleId: string, reason: string): Promise<VoidOrCorrectResult> {
    const { data, error } = await this.supabase.rpc("void_sale", {
      p_sale_id: saleId,
      p_reason: reason,
    });

    if (error || !data) {
      throw new Error(`SalesService.voidSale: ${error?.message}`);
    }

    return data;
  }

  async correctSale(input: {
    saleId: string;
    newAmount: number;
    newQuantity?: number | null;
    newNotes?: string | null;
    reason: string;
  }): Promise<VoidOrCorrectResult> {
    const { data, error } = await this.supabase.rpc("correct_sale", {
      p_sale_id: input.saleId,
      p_new_amount: input.newAmount,
      p_new_quantity: input.newQuantity ?? null,
      p_new_notes: input.newNotes ?? null,
      p_reason: input.reason,
    });

    if (error || !data) {
      throw new Error(`SalesService.correctSale: ${error?.message}`);
    }

    return data;
  }

  async reverseSale(saleId: string, reason: string): Promise<VoidOrCorrectResult> {
    const { data, error } = await this.supabase.rpc("reverse_sale", {
      p_sale_id: saleId,
      p_reason: reason,
    });

    if (error || !data) {
      throw new Error(`SalesService.reverseSale: ${error?.message}`);
    }

    return data;
  }

  /**
   * RLS (sales_select, migration 0005) already restricts the returned rows
   * to "all sales" or "just my own" depending on the caller's
   * sales.view_all/sales.view_own grants -- no separate filter needed here,
   * the same query works correctly for either permission level.
   *
   * `search` matches sale_number or the snapshotted product name (not a
   * live join to `products`, since a sale's own snapshot is what the user
   * is actually looking at in history -- consistent with 2d's "sales keep
   * their own snapshot regardless" decision). `dateFrom`/`dateTo` are
   * inclusive `sale_date` bounds (YYYY-MM-DD), matching the composite
   * `(tenant_id, sale_date)` index already in migration 0005.
   */
  async listRecent(
    tenantId: string,
    opts: {
      locationId?: string;
      limit?: number;
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {}
  ): Promise<SaleListItem[]> {
    let query = this.supabase
      .from("sales")
      .select("id, sale_number, product_name_snapshot, actual_amount, quantity, status, sale_time, recorded_by")
      .eq("tenant_id", tenantId)
      .order("sale_time", { ascending: false })
      .limit(opts.limit ?? 50);

    if (opts.locationId) {
      query = query.eq("location_id", opts.locationId);
    }

    if (opts.dateFrom) {
      query = query.gte("sale_date", opts.dateFrom);
    }

    if (opts.dateTo) {
      query = query.lte("sale_date", opts.dateTo);
    }

    if (opts.search) {
      const escaped = opts.search.replace(/[%_]/g, (c) => `\\${c}`);
      query = query.or(`sale_number.ilike.%${escaped}%,product_name_snapshot.ilike.%${escaped}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`SalesService.listRecent: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      saleNumber: row.sale_number,
      productNameSnapshot: row.product_name_snapshot,
      actualAmount: row.actual_amount,
      quantity: row.quantity,
      status: row.status,
      saleTime: row.sale_time,
      recordedBy: row.recorded_by,
    }));
  }
}

function isConflictError(error: { code?: string }): boolean {
  return error.code === "23505"; // Postgres unique_violation
}

function toRecordedSale(row: {
  id: string;
  sale_number: string | null;
  product_name_snapshot: string;
  actual_amount: number;
  sale_time: string;
}): Omit<RecordedSale, "replayed"> {
  return {
    id: row.id,
    saleNumber: row.sale_number,
    productNameSnapshot: row.product_name_snapshot,
    actualAmount: row.actual_amount,
    saleTime: row.sale_time,
  };
}
