"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { RoleService } from "@/services/RoleService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { createRoleSchema, type CreateRoleInput } from "@/validations/role";

export interface CreateRoleState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CreateRoleInput, string>>;
  success?: boolean;
  roleId?: string;
}

export async function createRoleAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: CreateRoleState,
  formData: FormData
): Promise<CreateRoleState> {
  const parsed = createRoleSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof CreateRoleInput>(parsed.error.issues) };
  }

  const permissionKeys = formData.getAll("permissionKeys").map(String);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const roleService = new RoleService(supabase);
  let roleId: string;

  try {
    await assertCan("roles.manage", { tenantId });

    const created = await roleService.createRole(
      tenantId,
      parsed.data.name,
      parsed.data.description ?? null,
      permissionKeys
    );
    roleId = created.roleId;

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user?.id ?? null,
        action: AUDIT_ACTION.PERMISSION_CHANGED,
        entityType: "role",
        entityId: roleId,
        newValues: { name: parsed.data.name, permissionKeys },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create role" };
  }

  revalidatePath(`/t/${tenantSlug}/roles`);

  return { success: true, roleId };
}
