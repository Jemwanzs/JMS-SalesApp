import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export interface ActiveTenant {
  tenantId: string;
  slug: string;
  /**
   * True until the tenant has at least one location, which the
   * onboarding wizard's Step 2 creates (features/onboarding). Used to
   * route first-time logins into /onboarding instead of straight to
   * /sales -- a deliberate simplification over a dedicated
   * "onboarding_completed_at" column (see
   * docs/20-development-progress.md): cheap, correct for Phase 1's
   * single-location-per-tenant reality, and avoids a migration for a
   * flag with only one real consumer.
   */
  needsOnboarding: boolean;
}

/**
 * A user belongs to at most one tenant today (invitations/multi-tenant
 * membership switching is Phase 4b) -- resolve the first active
 * membership they have. Separate queries rather than embedded
 * PostgREST relationship selects, since the hand-written provisional
 * database types don't carry relationship metadata for that syntax to
 * type-check cleanly (see docs/20-development-progress.md).
 */
export async function resolveActiveTenant(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<ActiveTenant | null> {
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

  // Both only need membership.tenant_id, not each other's result -- run
  // together instead of paying two sequential round trips on every
  // login/logout this helper runs during.
  const [{ data: tenant }, { count }] = await Promise.all([
    supabase.from("tenants").select("slug").eq("id", membership.tenant_id).maybeSingle(),
    supabase.from("locations").select("id", { count: "exact", head: true }).eq("tenant_id", membership.tenant_id),
  ]);

  if (!tenant) {
    return null;
  }

  return { tenantId: membership.tenant_id, slug: tenant.slug, needsOnboarding: !count };
}
