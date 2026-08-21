"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { AuditService } from "@/services/AuditService";
import { AuthService } from "@/services/AuthService";
import { SecurityService } from "@/services/SecurityService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveTenant } from "@/lib/tenant/resolve-active-tenant";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { loginSchema, type LoginInput } from "@/validations/auth";

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent"),
  };
}

export interface LoginActionState {
  error?: string;
  fieldErrors?: Partial<Record<keyof LoginInput, string>>;
  blockedBy?: "working_hours" | "geofence";
}

export async function signInAction(
  _prevState: LoginActionState,
  formData: FormData
): Promise<LoginActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof LoginInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const authService = new AuthService(supabase);
  const { ip, userAgent } = await requestMeta();
  const serviceRole = createServiceRoleClient();
  const securityService = new SecurityService(serviceRole);
  const auditService = new AuditService(serviceRole);

  let userId: string;
  try {
    const result = await authService.signIn(parsed.data);
    userId = result.userId;
  } catch (err) {
    // Best-effort: attach a profile_id to the failure log if this email
    // matches a real account, so repeated failures against one account
    // are visible together -- never surfaced to the client either way,
    // signInWithPassword's own error message already avoids confirming
    // account existence.
    const { data: maybeProfile } = await createServiceRoleClient()
      .from("profiles")
      .select("id")
      .eq("email", parsed.data.email)
      .maybeSingle();

    const failureReason = err instanceof Error ? err.message : "Sign in failed";

    await securityService
      .logLoginEvent({
        tenantId: null,
        profileId: maybeProfile?.id ?? null,
        ip,
        userAgent,
        success: false,
        failureReason,
      })
      .catch(() => {});

    await auditService
      .log({
        tenantId: null,
        actorProfileId: maybeProfile?.id ?? null,
        action: AUDIT_ACTION.FAILED_LOGIN,
        entityType: "session",
        reason: failureReason,
        ipAddress: ip,
        device: userAgent,
      })
      .catch(() => {});

    return { error: err instanceof Error ? err.message : "Sign in failed" };
  }

  const tenant = await resolveActiveTenant(supabase, userId);
  let bypassNotice: "working_hours" | "geofence" | undefined;

  if (tenant) {
    const rawLat = formData.get("latitude");
    const rawLng = formData.get("longitude");
    const latitude = typeof rawLat === "string" && rawLat.length > 0 ? Number(rawLat) : null;
    const longitude = typeof rawLng === "string" && rawLng.length > 0 ? Number(rawLng) : null;

    const gate = await authService.evaluateAccessGate({
      tenantId: tenant.tenantId,
      profileId: userId,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
    });

    if (gate.allowed && gate.bypassed) {
      bypassNotice = gate.blockedBy;
      await auditService
        .log({
          tenantId: tenant.tenantId,
          actorProfileId: userId,
          action: AUDIT_ACTION.ACCESS_RESTRICTION_BYPASSED,
          entityType: "session",
          reason: gate.reason ?? null,
          ipAddress: ip,
          device: userAgent,
          metadata: gate.blockedBy ? { blockedBy: gate.blockedBy } : null,
        })
        .catch(() => {});
    }

    if (!gate.allowed) {
      // The password WAS correct -- signInWithPassword already
      // established a real session/cookies -- so it must be torn back
      // down before returning an error, not just declined.
      await supabase.auth.signOut();

      const failureReason = gate.reason ?? "Blocked by access restrictions";

      await securityService
        .logLoginEvent({
          tenantId: tenant.tenantId,
          profileId: userId,
          ip,
          userAgent,
          success: false,
          failureReason,
        })
        .catch(() => {});

      await auditService
        .log({
          tenantId: tenant.tenantId,
          actorProfileId: userId,
          action: AUDIT_ACTION.FAILED_LOGIN,
          entityType: "session",
          reason: failureReason,
          ipAddress: ip,
          device: userAgent,
          metadata: gate.blockedBy ? { blockedBy: gate.blockedBy } : null,
        })
        .catch(() => {});

      return { error: gate.reason ?? "Sign in is currently restricted", blockedBy: gate.blockedBy };
    }
  }

  try {
    const [, session] = await Promise.all([
      securityService.logLoginEvent({
        tenantId: tenant?.tenantId ?? null,
        profileId: userId,
        ip,
        userAgent,
        success: true,
      }),
      securityService.createSession({
        profileId: userId,
        tenantId: tenant?.tenantId ?? null,
        ip,
        userAgent,
      }),
      auditService.log({
        tenantId: tenant?.tenantId ?? null,
        actorProfileId: userId,
        action: AUDIT_ACTION.LOGIN,
        entityType: "session",
        ipAddress: ip,
        device: userAgent,
      }),
    ]);

    // Correlates "which sessions row is THIS browser" for the security
    // page's "sign out of other devices" action -- carries no auth
    // authority of its own (just a row id), so it's fine as a plain
    // cookie rather than needing the same handling as a real session
    // token.
    const cookieStore = await cookies();
    cookieStore.set("sid", session.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch {
    // Best-effort -- session/login tracking never blocks a real sign-in.
  }

  if (!tenant) {
    redirect("/no-tenant");
  }

  const bypassQuery = bypassNotice ? `?adminBypass=${bypassNotice}` : "";
  redirect(
    tenant.needsOnboarding
      ? `/t/${tenant.slug}/onboarding${bypassQuery}`
      : `/t/${tenant.slug}/sales${bypassQuery}`
  );
}
