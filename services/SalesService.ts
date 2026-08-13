import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * SalesService — the highest-risk correctness surface in the app. Owns:
 *   - sale-number assignment (tenant-configurable template + atomic
 *     sale_number_sequences counter via BEFORE INSERT trigger)
 *   - idempotency-key handling (client-generated once per form mount;
 *     ON CONFLICT DO NOTHING + fall back to returning the existing row)
 *   - edit-window enforcement and VOID/CORRECT/REVERSE corrections
 *     (never a hard delete)
 * See docs/08-sales-engine.md.
 *
 * actual_amount is always the TOTAL charged, not a unit price — quantity
 * is informational only (docs/08-sales-engine.md's decision log).
 *
 * Not yet implemented — Phase 2d.
 */
export interface RecordSaleInput {
  tenantId: string;
  locationId: string;
  businessDayId: string;
  productId: string;
  actualAmount: number;
  quantity?: number | null;
  notes?: string | null;
  idempotencyKey: string;
}

export class SalesService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async recordSale(_input: RecordSaleInput) {
    throw new Error("SalesService.recordSale: not yet implemented (Phase 2d)");
  }

  async voidSale(_saleId: string, _reason: string) {
    throw new Error("SalesService.voidSale: not yet implemented (Phase 2e)");
  }
}
