"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { RoleService } from "@/services/RoleService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function deleteRoleAction(tenantId: string, tenantSlug: string, roleId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const roleService = new RoleService(supabase);

  await assertCan("roles.manage", { tenantId });
  await roleService.deleteRole(tenantId, roleId);

  await new AuditService(createServiceRoleClient())
    .log({
      tenantId,
      actorProfileId: user?.id ?? null,
      action: AUDIT_ACTION.PERMISSION_CHANGED,
      entityType: "role",
      entityId: roleId,
      reason: "Role deleted",
    })
    .catch(() => {});

  revalidatePath(`/t/${tenantSlug}/roles`);
}
