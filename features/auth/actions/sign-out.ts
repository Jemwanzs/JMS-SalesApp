"use server";

import { redirect } from "next/navigation";

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

  if (user) {
    const tenant = await resolveActiveTenant(supabase, user.id);
    await new AuditService(createServiceRoleClient())
      .log({
        tenantId: tenant?.tenantId ?? null,
        actorProfileId: user.id,
        action: AUDIT_ACTION.LOGOUT,
        entityType: "session",
      })
      .catch(() => {});
  }

  await authService.signOut();

  redirect("/login");
}
