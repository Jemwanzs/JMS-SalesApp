"use server";

import { AuditService } from "@/services/AuditService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface StartImpersonationState {
  error?: string;
  sessionId?: string;
  expiresAt?: string;
}

/**
 * "Access Workspace" (docs/15-super-admin.md): reason -> platform MFA ->
 * time-limited session -> immutable audit. The MFA step-up itself
 * happens client-side (access-workspace-dialog.tsx calls
 * supabase.auth.mfa.challengeAndVerify() against the platform admin's
 * OWN account, same client-SDK-passthrough pattern as mfa-enrollment.tsx)
 * -- this action is the server-side proof that it actually happened
 * (checking the session's real AAL, never trusting a client-supplied
 * flag), not the mechanism that performs it.
 *
 * Logs twice, deliberately: platform_audit_logs (via PlatformAdminService,
 * the platform's own immutable record, docs/15's "always logged, no
 * exceptions") AND the target tenant's own audit_logs (IMPERSONATION_
 * STARTED, actor = the real platform admin's profile id, never the
 * target's) -- whether tenants can see an impersonation occurred was
 * left as a policy decision per the doc; this app answers it "yes."
 */
export async function startImpersonationAction(
  targetTenantId: string,
  targetProfileId: string,
  reason: string,
  durationMinutes: number
): Promise<StartImpersonationState> {
  const platformAdminId = await requirePlatformAdminId();

  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { error: "A reason is required" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aalError || aal?.currentLevel !== "aal2") {
    return { error: "Two-factor verification is required to access a workspace" };
  }

  const service = new PlatformAdminService(createServiceRoleClient());

  try {
    const result = await service.startImpersonation({
      platformAdminId,
      targetTenantId,
      targetProfileId,
      reason: trimmedReason,
      durationMinutes,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId: targetTenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.IMPERSONATION_STARTED,
        entityType: "impersonation_session",
        entityId: result.sessionId,
        reason: trimmedReason,
        metadata: { target_profile_id: targetProfileId, expires_at: result.expiresAt },
      })
      .catch(() => {});

    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start impersonation" };
  }
}
