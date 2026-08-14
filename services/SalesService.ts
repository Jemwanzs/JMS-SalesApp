import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

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
 * Edit-window enforcement and VOID/CORRECT/REVERSE corrections are
 * Phase 2e/2g (need the approval engine) — not implemented here, and
 * deliberately not possible via any other path either: sales has no
 * UPDATE/DELETE RLS policy at all yet (migration 0005).
 */
export interface RecordSaleInput {
  tenantId: string;
  locationId: string;
  businessDayId: string;
  productId: string;
  actualAmount: number;
  quantity?: number | null;
  notes?: string | null;
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

    if (businessDay.status !== "open") {
      throw new Error(
        `SalesService.recordSale: business day is "${businessDay.status}", not open`
      );
    }

    const { data: product, error: productError } = await this.supabase
      .from("products")
      .select("name, image_url, expected_price")
      .eq("id", input.productId)
      .single();

    if (productError || !product) {
      throw new Error("SalesService.recordSale: product not found");
    }

    const { data: inserted, error: insertError } = await this.supabase
      .from("sales")
      .insert({
        tenant_id: input.tenantId,
        location_id: input.locationId,
        business_day_id: input.businessDayId,
        product_id: input.productId,
        product_name_snapshot: product.name,
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

  async voidSale(_saleId: string, _reason: string) {
    throw new Error("SalesService.voidSale: not yet implemented (Phase 2e)");
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
