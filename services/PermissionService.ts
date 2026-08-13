import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * PermissionService — read access to the global permission catalog
 * (seeded in supabase/migrations/0001_core_tenancy_and_rbac.sql). Thin —
 * the actual "does this user have permission X" resolution lives in the
 * has_permission()/get_my_permissions() SQL functions, wrapped by
 * lib/permissions/can.ts, not here. See docs/06-roles-permissions.md.
 *
 * Not yet implemented — Phase 1e.
 */
export class PermissionService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listCatalog() {
    throw new Error(
      "PermissionService.listCatalog: not yet implemented (Phase 1e)"
    );
  }
}
