"use server";

import { redirect } from "next/navigation";

import { AuditService } from "@/services/AuditService";
import { AuthService } from "@/services/AuthService";
import { SecurityService } from "@/services/SecurityService";
import { UserService } from "@/services/UserService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SelfDeleteAccountState {
  error?: string;
}

/**
 * Self-service account deletion for an invited employee (Google Play
 * Account Deletion policy). Decision: keep sales/audit records exactly
 * as recorded, only deactivate the membership -- the same mechanism as
 * an existing admin-disabled user (UserService.setActive), never a raw
 * delete. Session is torn down immediately (SecurityService.
 * forceSignOutUser called directly on self -- its own action wrapper,
 * forceSignOutUserAction, rejects self-targeting, but the service
 * method has no such guard, and self-targeting is exactly right here).
 *
 * A settings.manage holder is rejected outright: this button is for an
 * employee stepping away, not for the business itself, and letting an
 * admin quietly disable themselves this way risks leaving a tenant with
 * no one able to manage it. See request-tenant-deletion.ts for the
 * business-deletion counterpart such a user should use instead.
 *
 * Uses the service-role client throughout: tenant_memberships_update
 * RLS requires users.edit (see UserService.setActive's own header
 * comment), which a plain employee deleting themselves never holds.
 */
export async function selfDeleteAccountAction(tenantId: string): Promise<SelfDeleteAccountState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  if (await can("settings.manage", { tenantId })) {
    return { error: "Tenant Administrators must use \"Delete My Business\" instead of this option." };
  }

  const serviceRole = createServiceRoleClient();

  const { data: membership, error: membershipError } = await serviceRole
    .from("tenant_memberships")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("profile_id", user.id)
    .single();

  if (membershipError || !membership) {
    return { error: "Could not find your membership for this business" };
  }

  try {
    await new UserService(serviceRole).setActive(tenantId, membership.id, false);
    await new SecurityService(serviceRole).forceSignOutUser(user.id, tenantId, user.id);

    await new AuditService(serviceRole)
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.USER_SELF_DELETED,
        entityType: "tenant_membership",
        entityId: membership.id,
        reason: "Self-service account deletion",
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete your account" };
  }

  // The ban doesn't invalidate an already-issued access token instantly
  // -- an explicit sign-out gives the user an immediate, correct result
  // rather than a stale session that only dies on its next refresh.
  await new AuthService(supabase).signOut();
  redirect("/login");
}
