"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { SecurityService } from "@/services/SecurityService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ForceSignOutState {
  error?: string;
  success?: boolean;
}

/**
 * The tenant-side "admin-driven" half of docs/05's session-revoke
 * capability (self-service is signOutOtherSessionsAction). See
 * SecurityService.forceSignOutUser's own header comment for exactly
 * what this does and doesn't achieve.
 */
export async function forceSignOutUserAction(tenantId: string, tenantSlug: string, targetProfileId: string): Promise<ForceSignOutState> {
  await assertCan("security.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  if (targetProfileId === user.id) {
    return { error: "You can't force-sign-out your own account this way -- use \"Sign out of other devices\" instead" };
  }

  try {
    await new SecurityService(createServiceRoleClient()).forceSignOutUser(targetProfileId, tenantId, user.id);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.SESSION_REVOKED,
        entityType: "profile",
        entityId: targetProfileId,
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/security`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not sign out that user" };
  }
}
