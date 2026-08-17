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

  await assertCan("users.edit", { tenantId });
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
