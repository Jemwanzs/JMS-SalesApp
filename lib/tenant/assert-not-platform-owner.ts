import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Guards a destructive/lockout-style tenant action from ever being
 * pointed at the platform owner's own operating tenant (their billing
 * owner IS a platform_admins profile) -- extracted from
 * PlatformAdminService's own private method of the same shape (used by
 * suspendTenant/deactivateTenant/deleteTenant) so the same check applies
 * to Account Deletion's tenant-INITIATED request path
 * (TenantService.requestDeletion) too. Previously only platform-admin-
 * initiated actions were guarded against this; a Tenant Administrator
 * requesting deletion of their own tenant needs the identical check.
 */
export async function assertNotPlatformOwnerTenant(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  verb: string
): Promise<void> {
  const { data: tenant } = await supabase.from("tenants").select("billing_owner_profile_id").eq("id", tenantId).maybeSingle();

  if (!tenant?.billing_owner_profile_id) return;

  const { data: admin } = await supabase
    .from("platform_admins")
    .select("id")
    .eq("profile_id", tenant.billing_owner_profile_id)
    .maybeSingle();

  if (admin) {
    throw new Error(`Cannot ${verb} the platform owner's own tenant`);
  }
}
