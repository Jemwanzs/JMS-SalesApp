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
 * its service-role bootstrap sequence — the caller here MUST be the
 * service-role client, since a brand-new tenant has no role_permissions
 * yet for has_permission('roles.manage') to grant anyone (see the note
 * atop supabase/migrations/0001_core_tenancy_and_rbac.sql).
 */
export const DEFAULT_ROLE_GRANTS: Record<string, string[]> = {
  "Sales User": ["sales.create", "sales.view_own", "analytics.view_own"],
  Supervisor: [
    "sales.create",
    "sales.view_own",
    "analytics.view_own",
    "sales.view_all",
    "analytics.products",
    "reports.view",
  ],
  // Tenant Administrator gets every permission in the catalog — computed
  // from the live permission list at seed time (see seedDefaultRoles)
  // rather than hardcoded here, so it never silently falls out of sync
  // with the catalog as new permissions are added.
  "Tenant Administrator": [],
};

export interface SeededRole {
  roleId: string;
  name: string;
}

export class RoleService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async seedDefaultRoles(tenantId: string): Promise<SeededRole[]> {
    const { data: permissions, error: permError } = await this.supabase
      .from("permissions")
      .select("id, key");

    if (permError || !permissions) {
      throw new Error(
        `RoleService.seedDefaultRoles: failed to load permission catalog: ${permError?.message}`
      );
    }

    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

    const roleNames = Object.keys(DEFAULT_ROLE_GRANTS);
    const { data: insertedRoles, error: roleError } = await this.supabase
      .from("roles")
      .insert(
        roleNames.map((name) => ({
          tenant_id: tenantId,
          name,
          is_system_default: true,
        }))
      )
      .select("id, name");

    if (roleError || !insertedRoles) {
      throw new Error(
        `RoleService.seedDefaultRoles: failed to create default roles: ${roleError?.message}`
      );
    }

    const rolePermissionRows = insertedRoles.flatMap((role) => {
      const grantKeys =
        role.name === "Tenant Administrator"
          ? permissions.map((p) => p.key)
          : (DEFAULT_ROLE_GRANTS[role.name] ?? []);

      return grantKeys
        .map((key) => permissionIdByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({
          role_id: role.id,
          permission_id: permissionId,
        }));
    });

    if (rolePermissionRows.length > 0) {
      const { error: rolePermError } = await this.supabase
        .from("role_permissions")
        .insert(rolePermissionRows);

      if (rolePermError) {
        throw new Error(
          `RoleService.seedDefaultRoles: failed to grant permissions: ${rolePermError.message}`
        );
      }
    }

    return insertedRoles.map((r) => ({ roleId: r.id, name: r.name }));
  }

  async createRole(_tenantId: string, _name: string, _permissionKeys: string[]) {
    throw new Error("RoleService.createRole: not yet implemented (Phase 4a)");
  }
}
