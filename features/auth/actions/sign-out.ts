"use server";

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
      ]).catch(() => {});
    });
  }

  await authService.signOut();

  redirect("/login");
}
