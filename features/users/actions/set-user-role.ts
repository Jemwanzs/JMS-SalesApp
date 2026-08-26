"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { UserService } from "@/services/UserService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function setUserRoleAction(
  tenantId: string,
  tenantSlug: string,
  membershipId: string,
  roleId: string
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in");
  }

  const userService = new UserService(supabase);

  // roles.manage, not users.edit -- user_role_assignments_write's own RLS
  // policy (0001_core_tenancy_and_rbac.sql:520-523) has always required
  // roles.manage; asserting users.edit here just gave a misleading
  // permission-denied message instead of the DB's own raw RLS error for
  // the (already-nonfunctional) case of a caller holding one but not the
  // other. No change in who can actually reassign a role -- Tenant
  // Administrator holds both.
  await assertCan("roles.manage", { tenantId });
  await userService.setUserRole(tenantId, membershipId, roleId, user.id);

  await new AuditService(createServiceRoleClient())
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.ROLE_CHANGED,
      entityType: "tenant_membership",
      entityId: membershipId,
      newValues: { roleId },
    })
    .catch(() => {});

  revalidatePath(`/t/${tenantSlug}/users`);
}
