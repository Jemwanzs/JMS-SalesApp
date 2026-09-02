import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Multi-Branch User Access Phase 5 -- the counterpart to
 * resolve-user-branches.ts's login-time "which branches CAN this user
 * pick" question. This is "which branch did they actually pick for
 * THIS session," read the same way migration 0051's RLS policies read
 * it (current_active_location(), via active_branch_sessions keyed by
 * the JWT's own session_id) -- so a page that calls this and a query
 * that gets filtered by RLS are always looking at the same branch.
 *
 * Returns null if no row exists for this session (a session that
 * predates Phase 4/5, or the very rare active_branch_sessions write
 * failure) -- callers must treat that as "can't proceed," not "show
 * everything," matching the fail-closed RLS policies this mirrors.
 *
 * cache()-wrapped: the tenant layout and sales/page.tsx (and now
 * reports/page.tsx) each independently resolve the same tenant's
 * active branch for the same request -- same dedup reasoning as
 * getTenantBySlug's own header comment (lib/tenant/resolve-tenant-by-slug.ts).
 */
export const resolveActiveLocationId = cache(async function resolveActiveLocationId(
  supabase: SupabaseClient<Database>,
  tenantId: string
): Promise<string | null> {
  const { data: claims } = await supabase.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (!sessionId) {
    return null;
  }

  const { data } = await supabase
    .from("active_branch_sessions")
    .select("location_id")
    .eq("session_id", sessionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return data?.location_id ?? null;
});
