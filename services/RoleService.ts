import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * RoleService — role CRUD and default-role seeding at tenant creation.
 * Roles are per-tenant rows, not shared templates — seeding copies the
 * system-default permission grants into new rows owned by the tenant, so
 * a tenant can freely edit them afterward without affecting anyone else.
 * See docs/06-roles-permissions.md.
 *
 * seedDefaultRoles() is called by TenantService.createTenant() as part of
 * its service-role bootstrap sequence. Not yet implemented — Phase 1d.
 */
export class RoleService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async seedDefaultRoles(_tenantId: string): Promise<void> {
    throw new Error(
      "RoleService.seedDefaultRoles: not yet implemented (Phase 1d)"
    );
  }

  async createRole(_tenantId: string, _name: string, _permissionKeys: string[]) {
    throw new Error("RoleService.createRole: not yet implemented (Phase 4a)");
  }
}
