"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { UserService, type InviteUserResult } from "@/services/UserService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { inviteUserSchema, type InviteUserInput } from "@/validations/user";

export interface InviteUserState {
  error?: string;
  fieldErrors?: Partial<Record<keyof InviteUserInput, string>>;
  success?: boolean;
  membershipId?: string;
}

export async function inviteUserAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: InviteUserState,
  formData: FormData
): Promise<InviteUserState> {
  const parsed = inviteUserSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    roleId: formData.get("roleId"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof InviteUserInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  let result: InviteUserResult;

  try {
    await assertCan("users.create", { tenantId });

    // Looking up whether the invited email already has a profile
    // crosses tenant boundaries -- needs the service-role client, see
    // UserService.inviteUser's header comment. The permission check
    // above already ran against the RLS-respecting session, so this
    // isn't a privilege-escalation shortcut, just the one step RLS
    // structurally can't do for the acting admin.
    const serviceRole = createServiceRoleClient();
    const userService = new UserService(serviceRole);

    result = await userService.inviteUser({
      tenantId,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      roleId: parsed.data.roleId,
      invitedBy: user.id,
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/callback?next=/invite/confirm`,
    });

    await new AuditService(serviceRole)
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.USER_INVITED,
        entityType: "profile",
        entityId: result.profileId,
        newValues: { email: parsed.data.email },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not invite user" };
  }

  revalidatePath(`/t/${tenantSlug}/users`);

  return { success: true, membershipId: result.membershipId };
}
