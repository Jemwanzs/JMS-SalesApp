import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";
import { redirect } from "next/navigation";

import { UserList } from "@/features/users/components/user-list";
import { RoleService } from "@/services/RoleService";
import { UserService } from "@/services/UserService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Users | JMS Sales App",
};

/**
 * Phase 4b: users & invitations. Scoped per docs/07-ui-ux-screen-map.md's
 * "Users: Invite, role assignment, active/inactive" -- WHICH roles exist
 * is Phase 4a's Roles screen, this one is WHICH user holds WHICH role.
 * Invite-accept auto-flipping a membership from 'invited' to 'active' on
 * first login is not wired yet -- an admin can flip it manually here in
 * the meantime, deliberately deferred rather than built speculatively.
 */
export default async function UsersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  const tenantId = tenant!.id;

  const [canCreate, canEdit] = await Promise.all([
    can("users.create", { tenantId }),
    can("users.edit", { tenantId }),
  ]);

  if (!canCreate && !canEdit) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const [users, roles] = await Promise.all([
    new UserService(supabase).listUsers(tenantId, user!.id),
    new RoleService(supabase).listRoles(tenantId),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Users</h1>
      <UserList
        users={users}
        roles={roles.map((r) => ({ id: r.id, name: r.name }))}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        canCreate={canCreate}
        canEdit={canEdit}
      />
    </div>
  );
}
