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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The audit write doesn't gate anything the redirect depends on --
  // after() defers it until the response has been sent (unlike a bare
  // un-awaited promise, the platform keeps the function alive until it
  // actually finishes, so the log is never silently dropped), cutting
  // logout's perceived latency down to just the real signOut() call.
  if (user) {
    // Multi-Branch User Access Phase 4: a fresh login always gets a
    // fresh session_id, so this row is already unreachable via
    // current_active_location() the instant signOut() below
    // invalidates the session -- deleting it here is table hygiene,
    // not a security requirement. Read before signOut() runs since the
    // claim only exists on the still-live session.
    const { data: claims } = await supabase.auth.getClaims();
    const sessionId = claims?.claims.session_id;

    after(async () => {
      const serviceRole = createServiceRoleClient();
      const tenant = await resolveActiveTenant(supabase, user.id);

      await Promise.all([
        new AuditService(serviceRole)
          .log({
            tenantId: tenant?.tenantId ?? null,
            actorProfileId: user.id,
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
