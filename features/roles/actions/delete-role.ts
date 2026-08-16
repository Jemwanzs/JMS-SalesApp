"use server";

import { revalidatePath } from "next/cache";

import { RoleService } from "@/services/RoleService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export async function deleteRoleAction(tenantId: string, tenantSlug: string, roleId: string) {
  const supabase = await createClient();
  const roleService = new RoleService(supabase);

  await assertCan("roles.manage", { tenantId });
  await roleService.deleteRole(tenantId, roleId);

  revalidatePath(`/t/${tenantSlug}/roles`);
}
