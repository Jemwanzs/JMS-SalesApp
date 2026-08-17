"use server";

import { AuditService } from "@/services/AuditService";
import { AuthService } from "@/services/AuthService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveTenant } from "@/lib/tenant/resolve-active-tenant";
import type { RequestTemporaryAccessResult } from "@/types/database.types";

export interface RequestTemporaryAccessState {
  error?: string;
  result?: RequestTemporaryAccessResult;
}

/**
 * Only reachable from the login screen's geofence-blocked state (see
 * login-form.tsx) -- re-authenticates independently of whatever session
 * signInAction already tore down, submits the request while that fresh
 * session is briefly live (request_temporary_access is SECURITY DEFINER
 * and keys off auth.uid()), then signs out again. Mirrors sign-in.ts's
 * own sign-in/check/sign-out lifecycle rather than inventing a new one.
 */
export async function requestTemporaryAccessAction(
  _prevState: RequestTemporaryAccessState,
  formData: FormData
): Promise<RequestTemporaryAccessState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const durationMinutes = Number(formData.get("durationMinutes"));
  const rawLat = formData.get("latitude");
  const rawLng = formData.get("longitude");
  const latitude = typeof rawLat === "string" && rawLat.length > 0 ? Number(rawLat) : null;
  const longitude = typeof rawLng === "string" && rawLng.length > 0 ? Number(rawLng) : null;

  if (!email || !password) {
    return { error: "Missing credentials" };
  }
  if (!reason) {
    return { error: "A reason is required" };
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > 720) {
    return { error: "Requested duration must be between 1 minute and 12 hours" };
  }

  const supabase = await createClient();
  const authService = new AuthService(supabase);

  try {
    const { userId } = await authService.signIn({ email, password });
    const tenant = await resolveActiveTenant(supabase, userId);

    if (!tenant) {
      await supabase.auth.signOut();
      return { error: "No active tenant found for this account" };
    }

    const result = await authService.requestTemporaryAccess({
      tenantId: tenant.tenantId,
      reason,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      durationMinutes,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId: tenant.tenantId,
        actorProfileId: userId,
        action: AUDIT_ACTION.TEMPORARY_ACCESS_REQUESTED,
        entityType: "temporary_access_request",
        entityId: result.requestId,
        reason,
        metadata: { durationMinutes },
      })
      .catch(() => {});

    await supabase.auth.signOut();
    return { result };
  } catch (err) {
    await supabase.auth.signOut().catch(() => {});
    return { error: err instanceof Error ? err.message : "Could not submit request" };
  }
}
