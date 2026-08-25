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
 *
 * Every other method here is called through the RLS-respecting client on
 * behalf of a signed-in Tenant Administrator — RLS (roles_write/
 * role_permissions_write/user_role_assignments_write, migration 0001)
 * already gates all of it on roles.manage; the explicit tenant_id filters
 * below are defense in depth for a clear error message, same pattern as
 * ProductService.update, not the actual enforcement boundary.
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
    // Product Enhancements #3: read-only visibility into stock levels --
    // Sales User gets nothing new, deliberately (keeps Sales simple).
    "inventory.view",
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

export interface RoleDetail {
  id: string;
  name: string;
  description: string | null;
  isSystemDefault: boolean;
  permissionKeys: string[];
}

export interface RoleSummary extends RoleDetail {
  assignedUserCount: number;
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

  /**
   * permissionCount/assignedUserCount are computed client-side from two
   * bulk queries rather than a per-role RPC — a tenant's role count is
   * always small (a handful of custom roles at most), so this stays
   * cheap without needing SQL-side aggregation.
   */
  async listRoles(tenantId: string): Promise<RoleSummary[]> {
    const { data: roles, error: rolesError } = await this.supabase
      .from("roles")
      .select("id, name, description, is_system_default")
      .eq("tenant_id", tenantId)
      .order("is_system_default", { ascending: false })
      .order("name");

    if (rolesError) {
      throw new Error(`RoleService.listRoles: ${rolesError.message}`);
    }
    if (!roles || roles.length === 0) {
      return [];
    }

    const roleIds = roles.map((r) => r.id);

    const [{ data: rolePermissions }, { data: assignments }, { data: allPermissions }] = await Promise.all([
      this.supabase.from("role_permissions").select("role_id, permission_id").in("role_id", roleIds),
      this.supabase.from("user_role_assignments").select("role_id").in("role_id", roleIds),
      this.supabase.from("permissions").select("id, key"),
    ]);

    const keyByPermissionId = new Map((allPermissions ?? []).map((p) => [p.id, p.key]));
    const permKeysByRole = new Map<string, string[]>();
    for (const row of rolePermissions ?? []) {
      const key = keyByPermissionId.get(row.permission_id);
      if (!key) continue;
      permKeysByRole.set(row.role_id, [...(permKeysByRole.get(row.role_id) ?? []), key]);
    }
    const userCountByRole = new Map<string, number>();
    for (const row of assignments ?? []) {
      userCountByRole.set(row.role_id, (userCountByRole.get(row.role_id) ?? 0) + 1);
    }

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystemDefault: role.is_system_default,
      permissionKeys: permKeysByRole.get(role.id) ?? [],
      assignedUserCount: userCountByRole.get(role.id) ?? 0,
    }));
  }

  async getRole(tenantId: string, roleId: string): Promise<RoleDetail> {
    const { data: role, error: roleError } = await this.supabase
      .from("roles")
      .select("id, name, description, is_system_default")
      .eq("tenant_id", tenantId)
      .eq("id", roleId)
      .single();

    if (roleError || !role) {
      throw new Error(`RoleService.getRole: role not found`);
    }

    const { data: rolePermissions, error: rpError } = await this.supabase
      .from("role_permissions")
      .select("permission_id")
      .eq("role_id", roleId);

    if (rpError) {
      throw new Error(`RoleService.getRole: ${rpError.message}`);
    }

    const permissionIds = (rolePermissions ?? []).map((rp) => rp.permission_id);
    let permissionKeys: string[] = [];
    if (permissionIds.length > 0) {
      const { data: permissions, error: permError } = await this.supabase
        .from("permissions")
        .select("key")
        .in("id", permissionIds);

      if (permError) {
        throw new Error(`RoleService.getRole: ${permError.message}`);
      }
      permissionKeys = (permissions ?? []).map((p) => p.key);
    }

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystemDefault: role.is_system_default,
      permissionKeys,
    };
  }

  async createRole(
    tenantId: string,
    name: string,
    description: string | null,
    permissionKeys: string[]
  ): Promise<{ roleId: string }> {
    const { data: role, error: roleError } = await this.supabase
      .from("roles")
      .insert({ tenant_id: tenantId, name, description, is_system_default: false })
      .select("id")
      .single();

    if (roleError || !role) {
      if (roleError?.code === "23505") {
        throw new Error(`A role named "${name}" already exists`);
      }
      throw new Error(`RoleService.createRole: ${roleError?.message}`);
    }

    if (permissionKeys.length > 0) {
      await this.setRolePermissions(tenantId, role.id, permissionKeys);
    }

    return { roleId: role.id };
  }

  async updateRole(
    tenantId: string,
    roleId: string,
    input: { name: string; description: string | null }
  ): Promise<void> {
    const { error } = await this.supabase
      .from("roles")
      .update({ name: input.name, description: input.description })
      .eq("tenant_id", tenantId)
      .eq("id", roleId);

    if (error) {
      if (error.code === "23505") {
        throw new Error(`A role named "${input.name}" already exists`);
      }
      throw new Error(`RoleService.updateRole: ${error.message}`);
    }
  }

  /**
   * Full replace, not a diff — simpler and matches how the edit UI
   * submits the checkbox set (the whole desired state, not deltas).
   */
  async setRolePermissions(tenantId: string, roleId: string, permissionKeys: string[]): Promise<void> {
    const { data: role, error: roleError } = await this.supabase
      .from("roles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", roleId)
      .maybeSingle();

    if (roleError || !role) {
      throw new Error("RoleService.setRolePermissions: role not found");
    }

    const { data: permissions, error: permError } = await this.supabase
      .from("permissions")
      .select("id")
      .in("key", permissionKeys.length > 0 ? permissionKeys : [""]);

    if (permError) {
      throw new Error(`RoleService.setRolePermissions: ${permError.message}`);
    }

    const { error: deleteError } = await this.supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId);

    if (deleteError) {
      throw new Error(`RoleService.setRolePermissions: ${deleteError.message}`);
    }

    const rows = (permissions ?? []).map((p) => ({ role_id: roleId, permission_id: p.id }));
    if (rows.length > 0) {
      const { error: insertError } = await this.supabase.from("role_permissions").insert(rows);
      if (insertError) {
        throw new Error(`RoleService.setRolePermissions: ${insertError.message}`);
      }
    }
  }

  /**
   * Blocked for system-default roles (structural safety — nothing else
   * re-seeds them if removed) and for any role still assigned to a user
   * (role_permissions/user_role_assignments both cascade-delete with the
   * role, which would silently strip those users' access rather than
   * surfacing it as a decision the admin has to make first).
   */
  async deleteRole(tenantId: string, roleId: string): Promise<void> {
    const { data: role, error: roleError } = await this.supabase
      .from("roles")
      .select("id, is_system_default")
      .eq("tenant_id", tenantId)
      .eq("id", roleId)
      .maybeSingle();

    if (roleError || !role) {
      throw new Error("RoleService.deleteRole: role not found");
    }
    if (role.is_system_default) {
      throw new Error("System default roles cannot be deleted");
    }

    const { count, error: countError } = await this.supabase
      .from("user_role_assignments")
      .select("id", { count: "exact", head: true })
      .eq("role_id", roleId);

    if (countError) {
      throw new Error(`RoleService.deleteRole: ${countError.message}`);
    }
    if (count && count > 0) {
      throw new Error(
        `This role is still assigned to ${count} user${count === 1 ? "" : "s"} — reassign them first`
      );
    }

    const { error: deleteError } = await this.supabase
      .from("roles")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", roleId);

    if (deleteError) {
      throw new Error(`RoleService.deleteRole: ${deleteError.message}`);
    }
  }
}
