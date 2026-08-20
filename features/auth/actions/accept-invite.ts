"use server";

import { redirect } from "next/navigation";

import { AuditService } from "@/services/AuditService";
import { AuthService } from "@/services/AuthService";
import { UserService } from "@/services/UserService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { acceptInviteSchema, type AcceptInviteInput } from "@/validations/auth";

export interface AcceptInviteState {
  error?: string;
  fieldErrors?: Partial<Record<keyof AcceptInviteInput, string>>;
}

export async function acceptInviteAction(
  tenantId: string,
  tenantSlug: string,
  membershipId: string,
  _prevState: AcceptInviteState,
  formData: FormData
): Promise<AcceptInviteState> {
  const parsed = acceptInviteSchema.safeParse({
    fullName: formData.get("fullName"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof AcceptInviteInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new AuthService(supabase).updatePassword(parsed.data.password);

    // profiles_update_own RLS (id = auth.uid()) already permits this on
    // the ordinary session client -- no need for service-role here, only
    // the membership-status flip below structurally requires it.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ full_name: parsed.data.fullName })
      .eq("id", user.id);

    if (profileError) {
      return { error: `Could not save your name: ${profileError.message}` };
    }

    const serviceRole = createServiceRoleClient();
    await new UserService(serviceRole).acceptInvite(tenantId, membershipId, user.id);

    await new AuditService(serviceRole)
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.USER_ONBOARDED,
        entityType: "tenant_membership",
        entityId: membershipId,
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not complete setup" };
  }

  redirect(`/t/${tenantSlug}/sales`);
}
