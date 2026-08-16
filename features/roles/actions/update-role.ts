"use server";

import { revalidatePath } from "next/cache";

import { RoleService } from "@/services/RoleService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { updateRoleSchema, type UpdateRoleInput } from "@/validations/role";

export interface UpdateRoleState {
  error?: string;
  fieldErrors?: Partial<Record<keyof UpdateRoleInput, string>>;
  success?: boolean;
}

export async function updateRoleAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateRoleState,
  formData: FormData
): Promise<UpdateRoleState> {
  const parsed = updateRoleSchema.safeParse({
    roleId: formData.get("roleId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof UpdateRoleInput>(parsed.error.issues) };
  }

  const permissionKeys = formData.getAll("permissionKeys").map(String);
  const supabase = await createClient();
  const roleService = new RoleService(supabase);

  try {
    await assertCan("roles.manage", { tenantId });

    await roleService.updateRole(tenantId, parsed.data.roleId, {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    });
    await roleService.setRolePermissions(tenantId, parsed.data.roleId, permissionKeys);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update role" };
  }

  revalidatePath(`/t/${tenantSlug}/roles`);

  return { success: true };
}
