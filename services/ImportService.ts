import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * ImportService — historical sales + product bulk-upload workflow:
 * template -> upload -> validate -> preview -> resolve errors -> confirm
 * -> analytics rebuild. Confirmed rows go through the SAME SalesService/
 * ProductService insert path as live-captured data — no separate,
 * less-validated write path. See docs/12-imports-data-migration.md.
 *
 * Not yet implemented — Phase 5.
 */
export class ImportService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async validateFile(_importId: string) {
    throw new Error("ImportService.validateFile: not yet implemented (Phase 5b)");
  }

  async confirmImport(_importId: string) {
    throw new Error(
      "ImportService.confirmImport: not yet implemented (Phase 5c)"
    );
  }
}
