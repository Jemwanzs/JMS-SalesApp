"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { AuditService } from "@/services/AuditService";
import { AuthService } from "@/services/AuthService";
import { SecurityService } from "@/services/SecurityService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveTenant } from "@/lib/tenant/resolve-active-tenant";
import { resolveUserBranches } from "@/lib/tenant/resolve-user-branches";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { loginSchema, type LoginInput } from "@/validations/auth";

async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent"),
  };
}

// Hardening roadmap Phase 2.1 (docs/22-hardening-roadmap.md). A sliding
// window, not a permanent lock -- see SecurityService.countRecentFailedLogins's
// own header comment for why. byIp's threshold is deliberately much
// higher than byProfile's: many real users can share one IP (office
// wifi, mobile carrier NAT), so it exists to catch a broad sweep across
// many unknown emails, not to gate ordinary shared-network logins.
const LOCKOUT_WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_PROFILE = 5;
const MAX_FAILURES_PER_IP = 20;

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

  // Resolved once, up front -- reused both for the lockout pre-check
  // below and the failure-logging path, instead of a second lookup only
  // in the catch block. Never surfaced to the client either way,
  // signInWithPassword's own error message already avoids confirming
  // account existence.
  const { data: maybeProfile } = await serviceRole.from("profiles").select("id").eq("email", parsed.data.email).maybeSingle();

  const recentFailures = await securityService
    .countRecentFailedLogins({ profileId: maybeProfile?.id ?? null, ip, windowMinutes: LOCKOUT_WINDOW_MINUTES })
    .catch(() => ({ byProfile: 0, byIp: 0 }));

  if (recentFailures.byProfile >= MAX_FAILURES_PER_PROFILE || recentFailures.byIp >= MAX_FAILURES_PER_IP) {
    return { error: "Too many failed sign-in attempts. Please wait a few minutes and try again." };
  }

  let userId: string;
  try {
    const result = await authService.signIn(parsed.data);
    userId = result.userId;
  } catch (err) {
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

  // Hardening roadmap Phase 6 (docs/22-hardening-roadmap.md): checked
  // immediately after password auth succeeds, before
  // resolveActiveTenant's own active-only lookup -- see
  // AuthService.checkAccountStatus's own header comment for exactly
  // what gap this closes (a disabled member or a suspended/deactivated
  // tenant could previously still complete sign-in and land on a
  // confusing fallback instead of a clear rejection).
  const accountStatus = await authService.checkAccountStatus(userId);
  if (accountStatus.blocked) {
    // Password WAS correct -- signInWithPassword already established a
    // real session/cookies -- so it must be torn back down before
    // returning an error, same as the access-gate rejection below.
    await supabase.auth.signOut();

    await securityService
      .logLoginEvent({
        tenantId: null,
        profileId: userId,
        ip,
        userAgent,
        success: false,
        failureReason: accountStatus.reason ?? "Account status blocked sign-in",
      })
      .catch(() => {});

    await auditService
      .log({
        tenantId: null,
        actorProfileId: userId,
        action: AUDIT_ACTION.FAILED_LOGIN,
        entityType: "session",
        reason: accountStatus.reason ?? "Account status blocked sign-in",
        ipAddress: ip,
        device: userAgent,
        metadata: accountStatus.blockedBy ? { blockedBy: accountStatus.blockedBy } : null,
      })
      .catch(() => {});

    return { error: accountStatus.reason ?? "Sign in is currently unavailable for this account." };
  }

  const tenant = await resolveActiveTenant(supabase, userId);
  let bypassNotice: "working_hours" | "geofence" | undefined;

  // Account Deletion (Feature 1): checkAccountStatus above deliberately
  // lets sign-in through for a tenant deactivated by its OWN pending
  // self-service deletion request (the requester has to be able to log
  // back in to cancel it). Resolved once here, checked again below --
  // AFTER session creation, so a genuinely successful authentication
  // still gets its session/login-event/audit trail exactly as normal,
  // and BEFORE evaluateAccessGate/branch-resolution, which have nothing
  // meaningful to do for a tenant nobody can access anyway.
  let tenantIsDeactivated = false;
  if (tenant) {
    const { data: tenantRow } = await supabase.from("tenants").select("status").eq("id", tenant.tenantId).maybeSingle();
    tenantIsDeactivated = tenantRow?.status === "deactivated";
  }

  if (tenant && !tenantIsDeactivated) {
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
      // Deferred via after(), matching the success-path login/audit
      // logs further down -- nothing downstream reads this write's
      // result, so there's no reason to make the redirect wait on it.
      after(() =>
        auditService
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
          .catch(() => {})
      );
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
    // Only createSession's result is needed before the redirect (its id
    // becomes the "sid" cookie) -- logLoginEvent and the audit log are
    // pure tracking that nothing downstream reads, so they're deferred
    // via after() instead of sharing this Promise.all: the redirect no
    // longer waits on two writes it never needed the result of, while
    // after() (unlike a bare un-awaited promise) keeps the platform
    // function alive until they actually finish, so neither log is ever
    // silently dropped.
    const session = await securityService.createSession({
      profileId: userId,
      tenantId: tenant?.tenantId ?? null,
      ip,
      userAgent,
    });

    after(async () => {
      await Promise.all([
        securityService.logLoginEvent({
          tenantId: tenant?.tenantId ?? null,
          profileId: userId,
          ip,
          userAgent,
          success: true,
        }),
        auditService.log({
          tenantId: tenant?.tenantId ?? null,
          actorProfileId: userId,
          action: AUDIT_ACTION.LOGIN,
          entityType: "session",
          ipAddress: ip,
          device: userAgent,
        }),
      ]).catch(() => {});
    });

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

  if (tenantIsDeactivated) {
    redirect("/tenant-deactivated");
  }

  const bypassQuery = bypassNotice ? `?adminBypass=${bypassNotice}` : "";

  // Multi-Branch User Access Phase 4. Skipped entirely while onboarding
  // is still pending -- a tenant with no location yet has nothing to
  // resolve, and needsOnboarding already routes to the wizard below.
  // Deliberately NOT inside the best-effort try/catch above: a failed
  // write here would silently land the user on /sales with every
  // branch-scoped RLS policy failing closed (fails to "match nothing"
  // -- Phase 5), which reads as a confusingly empty app, not an error.
  // Better to surface a real failure than that.
  if (!tenant.needsOnboarding) {
    const branches = await resolveUserBranches(supabase, tenant.tenantId, userId);

    if (branches.length > 1) {
      redirect(`/select-branch${bypassQuery}`);
    }

    if (branches.length === 1) {
      const { data: claims } = await supabase.auth.getClaims();
      const sessionId = claims?.claims.session_id;
      if (sessionId) {
        await createServiceRoleClient()
          .from("active_branch_sessions")
          .upsert({ session_id: sessionId, profile_id: userId, tenant_id: tenant.tenantId, location_id: branches[0].id });
      }
    }
    // branches.length === 0 -- no branch assignment at all (shouldn't
    // happen in practice, see resolveUserBranches' own header comment)
    // falls through to the ordinary redirect below rather than blocking
    // sign-in outright; every branch-scoped policy will just fail
    // closed until an admin fixes the assignment, same as any other
    // missing-permission state elsewhere in this app.
  }

  redirect(
    tenant.needsOnboarding
      ? `/t/${tenant.slug}/onboarding${bypassQuery}`
      : `/t/${tenant.slug}/sales${bypassQuery}`
  );
}
