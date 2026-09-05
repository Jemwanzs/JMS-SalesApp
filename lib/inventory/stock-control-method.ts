import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { TenantService } from "@/services/TenantService";

export type StockControlMethod = "quantity" | "value";

/**
 * The tenant-wide "Record Stock By" choice (Settings -> Inventory
 * Configuration), replacing what used to be a per-product setting --
 * a business tracks its stock by value or by count as one coherent
 * policy, not product-by-product (see docs/21-inventory-management.md).
 * Defaults to 'value' when never explicitly set, matching this
 * feature's own stated default. The one place this default is decided
 * -- every reader (Sales, Stock In/Adjust, Reconciliation, Settings)
 * goes through this instead of repeating the `?? "value"` fallback.
 */
export async function getStockControlMethod(supabase: SupabaseClient<Database>, tenantId: string): Promise<StockControlMethod> {
  const value = await new TenantService(supabase).getSetting<string>(tenantId, "stock_control_method");
  return value === "quantity" ? "quantity" : "value";
}
