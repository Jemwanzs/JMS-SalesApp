"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { UserService } from "@/services/UserService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ResendInviteState {
  error?: string;
  success?: boolean;
}

export async function resendInviteAction(
  tenantId: string,
  tenantSlug: string,
  membershipId: string
): Promise<ResendInviteState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("users.create", { tenantId });

    // Same reasoning as invite-user.ts: the actual resend is an Admin
    // API call (auth.admin.inviteUserByEmail), unreachable from the
    // RLS-respecting client regardless of permissions -- the check
    // above already ran against the real session first.
    const serviceRole = createServiceRoleClient();
    await new UserService(serviceRole).resendInvite(
      tenantId,
      membershipId,
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback?next=/invite/confirm`
    );

    await new AuditService(serviceRole)
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.USER_INVITE_RESENT,
        entityType: "tenant_membership",
        entityId: membershipId,
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not resend invite" };
  }

  revalidatePath(`/t/${tenantSlug}/users`);
  return { success: true };
}
