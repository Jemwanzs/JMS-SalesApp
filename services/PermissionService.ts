import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * PermissionService — read access to the global permission catalog
 * (seeded in supabase/migrations/0001_core_tenancy_and_rbac.sql). Thin —
 * the actual "does this user have permission X" resolution lives in the
 * has_permission()/get_my_permissions() SQL functions, wrapped by
 * lib/permissions/can.ts, not here. See docs/06-roles-permissions.md.
 */
export interface PermissionCatalogItem {
  id: string;
  key: string;
  module: string;
  description: string | null;
}

export class PermissionService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * The catalog is global (no tenant_id column, readable by any
   * authenticated user per migration 0001's permissions_select policy) --
   * used by the roles UI to render one checkbox group per module.
   */
  async listCatalog(): Promise<PermissionCatalogItem[]> {
    const { data, error } = await this.supabase
      .from("permissions")
      .select("id, key, module, description")
      .order("module")
      .order("key");

    if (error) {
      throw new Error(`PermissionService.listCatalog: ${error.message}`);
    }

    return data ?? [];
  }
}
