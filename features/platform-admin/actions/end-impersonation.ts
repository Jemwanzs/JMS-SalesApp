"use server";

import { AuditService } from "@/services/AuditService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Ends an impersonation session early (the SUPPORT MODE banner's "End
 * session" button). A session past its expires_at is already denied
 * everything by migration 0024's SQL functions regardless of whether
 * this ever runs -- this exists for the deliberate "I'm done" case and
 * for the audit record's own end timestamp, not as the only way access
 * actually stops.
 */
export async function endImpersonationAction(sessionId: string, targetTenantId: string): Promise<{ error?: string }> {
  const platformAdminId = await requirePlatformAdminId();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const service = new PlatformAdminService(createServiceRoleClient());

  try {
    await service.endImpersonation(platformAdminId, sessionId);

    if (user) {
      await new AuditService(createServiceRoleClient())
        .log({
          tenantId: targetTenantId,
          actorProfileId: user.id,
          action: AUDIT_ACTION.IMPERSONATION_ENDED,
          entityType: "impersonation_session",
          entityId: sessionId,
        })
        .catch(() => {});
    }

    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not end impersonation" };
  }
}
