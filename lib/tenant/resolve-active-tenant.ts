import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * A user belongs to at most one tenant today (invitations/multi-tenant
 * membership switching is Phase 4b) -- resolve the first active
 * membership they have. Two queries rather than an embedded
 * tenant_memberships->tenants select, since the hand-written provisional
 * database types don't carry relationship metadata for that syntax to
 * type-check cleanly (see docs/20-development-progress.md).
 */
export async function resolveActiveTenantSlug(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<string | null> {
  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("tenant_id")
    .eq("profile_id", profileId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return null;
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", membership.tenant_id)
    .maybeSingle();

  return tenant?.slug ?? null;
}
