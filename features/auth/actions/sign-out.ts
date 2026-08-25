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
    after(async () => {
      const tenant = await resolveActiveTenant(supabase, user.id);
      await new AuditService(createServiceRoleClient())
        .log({
          tenantId: tenant?.tenantId ?? null,
          actorProfileId: user.id,
          action: AUDIT_ACTION.LOGOUT,
          entityType: "session",
        })
        .catch(() => {});
    });
  }

  await authService.signOut();

  redirect("/login");
}
