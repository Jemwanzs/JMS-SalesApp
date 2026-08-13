import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * ProductService — CRUD, Supabase Storage image handling, drag-drop
 * display_order, active/inactive/archived lifecycle (never hard-deleted —
 * historical sales keep their own snapshot regardless). See
 * docs/10-products.md.
 *
 * Not yet implemented — Phase 2a.
 */
export class ProductService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async create(_tenantId: string, _input: { name: string; expectedPrice?: number }) {
    throw new Error("ProductService.create: not yet implemented (Phase 2a)");
  }

  async reorder(_tenantId: string, _orderedProductIds: string[]) {
    throw new Error("ProductService.reorder: not yet implemented (Phase 2a)");
  }
}
