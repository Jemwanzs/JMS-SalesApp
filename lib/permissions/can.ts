import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export interface ResolvedPermission {
  permissionKey: string;
  locationId: string | null;
}

/**
 * Resolves the current user's full permission set for one tenant, once per
 * request. Wrapped in React's cache() so every server component/action/
 * route handler in a single request reuses one DB round trip regardless of
 * how many can() checks occur downstream.
 *
 * This calls the SAME get_my_permissions() SQL function that backs
 * has_permission() inside RLS policies (see
 * supabase/migrations/0001_core_tenancy_and_rbac.sql) — the join logic
 * lives in exactly one place. This function does not, and must never,
 * reimplement it in TypeScript. See docs/06-roles-permissions.md.
 */
export const getMyPermissions = cache(
  async (tenantId: string): Promise<ResolvedPermission[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_my_permissions", {
      p_tenant_id: tenantId,
    });

    if (error) {
      throw new Error(
        `Failed to resolve permissions for tenant ${tenantId}: ${error.message}`
      );
    }

    return (data ?? []).map((row) => ({
      permissionKey: row.permission_key,
      locationId: row.location_id,
    }));
  }
);

export interface CanOptions {
  tenantId: string;
  locationId?: string | null;
}

/**
 * App-layer permission check. Prefer this in server actions/route handlers
 * for early returns with good error messages — RLS is the enforced
 * boundary regardless (defense in depth, see docs/02-system-architecture.md),
 * so a bug here is a UX problem, not a security hole.
 *
 * Reads from the request-scoped cache seeded by getMyPermissions(); does
 * not query membership/role tables directly.
 */
export async function can(
  permission: string,
  { tenantId, locationId = null }: CanOptions
): Promise<boolean> {
  const permissions = await getMyPermissions(tenantId);

  return permissions.some(
    (p) =>
      p.permissionKey === permission &&
      (p.locationId === null || locationId === null || p.locationId === locationId)
  );
}

/**
 * Throws if the caller lacks the permission — use at the top of a server
 * action/service method to fail fast with a clear message instead of
 * letting a downstream RLS-denied query surface as a confusing empty
 * result or generic error.
 */
export async function assertCan(
  permission: string,
  opts: CanOptions
): Promise<void> {
  if (!(await can(permission, opts))) {
    throw new Error(
      `Permission denied: missing "${permission}" for tenant ${opts.tenantId}`
    );
  }
}
