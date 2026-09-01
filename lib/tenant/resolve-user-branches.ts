import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

export interface BranchOption {
  id: string;
  name: string;
}

/**
 * Multi-Branch User Access Phase 4 -- which branches a signed-in user
 * is actually allowed to work in, for the login flow to decide between
 * "straight into the tenant" (exactly one) and the Select Branch screen
 * (two or more). Mirrors UserService.listUsers' own null-location
 * convention: a user_role_assignments row with location_id = null
 * means every branch the tenant CURRENTLY has (not a frozen snapshot),
 * so a tenant that adds a second branch later doesn't strand anyone.
 *
 * Called through the RLS-respecting client, same as
 * lib/tenant/resolve-active-tenant.ts -- tenant_memberships_select and
 * user_role_assignments_select are both is_tenant_member-gated
 * (migration 0001), which the caller already satisfies by definition
 * (they're resolving their OWN membership).
 */
export async function resolveUserBranches(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  profileId: string
): Promise<BranchOption[]> {
  const { data: membership } = await supabase
    .from("tenant_memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!membership) {
    return [];
  }

  const { data: assignments } = await supabase
    .from("user_role_assignments")
    .select("location_id")
    .eq("tenant_membership_id", membership.id);

  const hasTenantWideAssignment = (assignments ?? []).some((a) => a.location_id === null);
  const specificLocationIds = [...new Set((assignments ?? []).map((a) => a.location_id).filter((id): id is string => id !== null))];

  const { data: locations } = await supabase
    .from("locations")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (hasTenantWideAssignment || !assignments || assignments.length === 0) {
    // No assignment row at all is the same "not scoped" default a
    // tenant-wide row represents -- shouldn't happen in practice
    // (every invite/setUserRole call writes at least one row), but
    // failing open to "every branch" here would be wrong; failing to
    // "every branch that exists" matches what null already means.
    return locations ?? [];
  }

  return (locations ?? []).filter((l) => specificLocationIds.includes(l.id));
}
