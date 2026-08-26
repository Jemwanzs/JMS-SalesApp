import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";
import { redirect } from "next/navigation";

import { RoleList } from "@/features/roles/components/role-list";
import { PermissionService } from "@/services/PermissionService";
import { RoleService } from "@/services/RoleService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Roles | JMS Sales App",
};

/**
 * Phase 4a: custom roles UI. Scoped to the role catalog itself (create/
 * edit/delete a role, choose its permission grants) -- WHICH user holds
 * WHICH role is Phase 4b's Users & Invitations screen, per docs/07-ui-
 * ux-screen-map.md folding "role assignment" into that screen, not this
 * one. RLS (roles_write/role_permissions_write, migration 0001) already
 * gates every mutation on roles.manage regardless of this page-level
 * redirect -- the redirect is a UX nicety, not the enforcement boundary.
 */
export default async function RolesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const tenant = await getTenantBySlug(supabase, tenantSlug);
  const tenantId = tenant!.id;

  if (!(await can("roles.manage", { tenantId }))) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const [roles, catalog] = await Promise.all([
    new RoleService(supabase).listRoles(tenantId),
    new PermissionService(supabase).listCatalog(),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Roles</h1>
      <RoleList roles={roles} catalog={catalog} tenantId={tenantId} tenantSlug={tenantSlug} />
    </div>
  );
}
