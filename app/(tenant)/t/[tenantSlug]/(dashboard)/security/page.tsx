import type { Metadata } from "next";
import { cookies } from "next/headers";

import { GeofenceRestrictionCard } from "@/features/security/components/geofence-restriction-card";
import { LoginEventList } from "@/features/security/components/login-event-list";
import { MfaEnrollment } from "@/features/security/components/mfa-enrollment";
import { SessionList } from "@/features/security/components/session-list";
import { WorkingHoursRestrictionToggle } from "@/features/security/components/working-hours-restriction-toggle";
import { SecurityService } from "@/services/SecurityService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Security | JMS Sales App",
};

/**
 * Phase 4c/4e: security centre -- login_events + sessions + MFA
 * enrollment + working-hours login restriction (docs/05-authentication-
 * security.md) -- geo-fencing/temporary-access, download security, and
 * the full audit_logs coverage pass are separate, later Phase 4
 * increments. Always reachable (every signed-in user manages their own
 * sessions/MFA factor); the tenant-wide activity section and the
 * working-hours toggle only render for security.manage/settings.manage
 * holders respectively, matching RLS's own gating on the underlying
 * tables. MFA enrollment doesn't need any data fetched here --
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
  const [canManageSecurity, canManageSettings] = await Promise.all([
    can("security.manage", { tenantId }),
    can("settings.manage", { tenantId }),
  ]);
  const cookieStore = await cookies();
  const currentSessionId = cookieStore.get("sid")?.value ?? null;

  const securityService = new SecurityService(supabase);
  const tenantService = new TenantService(supabase);
  const [sessions, myEvents, tenantEvents, workingHoursRestricted, geofenceRestricted, geofence] =
    await Promise.all([
      securityService.listSessions(user!.id),
      securityService.listLoginEvents(user!.id),
      canManageSecurity ? securityService.listTenantLoginEvents(tenantId) : Promise.resolve([]),
      canManageSettings
        ? tenantService.getSetting<boolean>(tenantId, "restrict_login_to_working_hours")
        : Promise.resolve(null),
      canManageSettings
        ? tenantService.getSetting<boolean>(tenantId, "restrict_login_to_geofence")
        : Promise.resolve(null),
      canManageSettings ? tenantService.getPrimaryLocationGeofence(tenantId) : Promise.resolve(null),
    ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Security</h1>
      <MfaEnrollment />
      {canManageSettings && (
        <WorkingHoursRestrictionToggle
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          initialEnabled={workingHoursRestricted === true}
        />
      )}
      {canManageSettings && (
        <GeofenceRestrictionCard
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          initialEnabled={geofenceRestricted === true}
          initialLatitude={geofence?.latitude ?? null}
          initialLongitude={geofence?.longitude ?? null}
          initialRadiusMeters={geofence?.radiusMeters ?? null}
        />
      )}
      <SessionList sessions={sessions} currentSessionId={currentSessionId} />
      <LoginEventList title="Your recent sign-ins" events={myEvents} />
      {canManageSecurity && <LoginEventList title="Tenant-wide sign-in activity" events={tenantEvents} />}
    </div>
  );
}
