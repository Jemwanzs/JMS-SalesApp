"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { UserService } from "@/services/UserService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function setUserActiveAction(
  tenantId: string,
  tenantSlug: string,
  membershipId: string,
  active: boolean
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userService = new UserService(supabase);

  await assertCan("users.edit", { tenantId });
  await userService.setActive(tenantId, membershipId, active);

  await new AuditService(createServiceRoleClient())
    .log({
      tenantId,
      actorProfileId: user?.id ?? null,
      action: active ? AUDIT_ACTION.USER_ENABLED : AUDIT_ACTION.USER_DISABLED,
      entityType: "tenant_membership",
      entityId: membershipId,
    })
    .catch(() => {});

  revalidatePath(`/t/${tenantSlug}/users`);
}
