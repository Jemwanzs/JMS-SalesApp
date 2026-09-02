"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { AuditService } from "@/services/AuditService";
import { AuthService } from "@/services/AuthService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveTenant } from "@/lib/tenant/resolve-active-tenant";

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const authService = new AuthService(supabase);

  // A single getClaims() call replaces what used to be getUser() +
  // getClaims() -- both the user id (the JWT's standard "sub" claim)
  // and session_id come off the same already-decoded token, so there's
  // no need for a second real network validation round trip just to
  // get the id getClaims() already carries. Safe here specifically
  // because everything below is best-effort audit/cleanup work, never
  // a security decision -- the actual sign-out a few lines down is
  // what tears the session down regardless of what's read here.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  const sessionId = claims?.claims.session_id;

  // Smart Auto-Login & 12-Hour Session: the `sid` cookie (features/auth/
  // actions/sign-in.ts) correlates this browser to its `sessions` row --
  // a manual logout should terminate that tracked row immediately too,
  // not just the real Supabase auth cookies (which authService.signOut()
  // below already correctly clears; a manually-logged-out user was never
  // actually at risk of silent auto-relogin -- this is closing a
  // tracking gap, not a security hole).
  const cookieStore = await cookies();
  const sid = cookieStore.get("sid")?.value;
  cookieStore.delete("sid");

  // The audit write doesn't gate anything the redirect depends on --
  // after() defers it until the response has been sent (unlike a bare
  // un-awaited promise, the platform keeps the function alive until it
  // actually finishes, so the log is never silently dropped), cutting
  // logout's perceived latency down to just the real signOut() call.
  if (userId) {
    after(async () => {
      const serviceRole = createServiceRoleClient();
      const tenant = await resolveActiveTenant(supabase, userId);

      await Promise.all([
        new AuditService(serviceRole)
          .log({
            tenantId: tenant?.tenantId ?? null,
            actorProfileId: userId,
            action: AUDIT_ACTION.LOGOUT,
            entityType: "session",
          })
          .catch(() => {}),
        sessionId
          ? serviceRole.from("active_branch_sessions").delete().eq("session_id", sessionId)
          : Promise.resolve(),
        sid
          ? serviceRole
              .from("sessions")
              .update({ revoked_at: new Date().toISOString(), revoked_by: userId, revoked_reason: "Signed out" })
              .eq("id", sid)
              .is("revoked_at", null)
          : Promise.resolve(),
      ]).catch(() => {});
    });
  }

  await authService.signOut();

  redirect("/login");
}
