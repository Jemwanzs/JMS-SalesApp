import type { Metadata } from "next";
import { cookies } from "next/headers";

import { LoginEventList } from "@/features/security/components/login-event-list";
import { MfaEnrollment } from "@/features/security/components/mfa-enrollment";
import { SessionList } from "@/features/security/components/session-list";
import { SecurityService } from "@/services/SecurityService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Security | JMS Sales App",
};

/**
 * Phase 4c: security centre -- login_events + sessions + MFA enrollment
 * (docs/05-authentication-security.md) -- working-hours restriction,
 * geo-fencing/temporary-access, download security, and the full
 * audit_logs coverage pass are separate, later Phase 4 increments.
 * Always reachable (every signed-in user manages their own sessions/MFA
 * factor); the tenant-wide activity section only renders for security.
 * manage holders, matching RLS's own self-or-security.manage visibility
 * on both tables. MFA enrollment doesn't need any data fetched here --
 * MfaEnrollment calls supabase.auth.mfa.* directly against the caller's
 * own session (see its own header comment).
 */
export default async function SecurityPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  const tenantId = tenant!.id;
  const canManage = await can("security.manage", { tenantId });
  const cookieStore = await cookies();
  const currentSessionId = cookieStore.get("sid")?.value ?? null;

  const securityService = new SecurityService(supabase);
  const [sessions, myEvents, tenantEvents] = await Promise.all([
    securityService.listSessions(user!.id),
    securityService.listLoginEvents(user!.id),
    canManage ? securityService.listTenantLoginEvents(tenantId) : Promise.resolve([]),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Security</h1>
      <MfaEnrollment />
      <SessionList sessions={sessions} currentSessionId={currentSessionId} />
      <LoginEventList title="Your recent sign-ins" events={myEvents} />
      {canManage && <LoginEventList title="Tenant-wide sign-in activity" events={tenantEvents} />}
    </div>
  );
}
