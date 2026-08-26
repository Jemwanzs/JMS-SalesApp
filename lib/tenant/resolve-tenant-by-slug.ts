import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];

/**
 * Hardening roadmap Phase 1 (docs/22-hardening-roadmap.md, performance
 * finding #4): the tenant layout already resolves `tenants` by slug, but
 * Server Components can't read that result back out of a parent layout,
 * so every dashboard page/route under app/(tenant)/t/[tenantSlug]/ ran
 * its own independent `tenants.select(...).eq("slug", tenantSlug)` --
 * one extra DB round trip per navigation, times ~20 routes, never
 * deduped. Same fix as lib/supabase/current-user.ts already applied to
 * getUser(): wrap in React's cache() so every caller within one request
 * reuses the same in-flight/resolved row instead of re-querying.
 *
 * Selects the full row (a small, single-row reference table) rather than
 * a hand-maintained per-caller column list -- callers destructure only
 * what they need, and a future page needing one more column never has to
 * touch this helper or add a second, differently-shaped cached query.
 *
 * cache() keys purely on arguments, not on which supabase client instance
 * is passed -- safe here since every caller in a given request tree uses
 * the same request-scoped RLS-respecting server client from
 * lib/supabase/server.ts, never a mix of clients for the same slug.
 */
export const getTenantBySlug = cache(
  async (supabase: SupabaseClient<Database>, tenantSlug: string): Promise<TenantRow | null> => {
    const { data } = await supabase.from("tenants").select("*").eq("slug", tenantSlug).maybeSingle();
    return data ?? null;
  }
);
