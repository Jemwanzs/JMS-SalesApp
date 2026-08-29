import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";
import { cookies } from "next/headers";

import { DownloadSecurityCard } from "@/features/security/components/download-security-card";
import { FontPreferenceCard } from "@/features/security/components/font-preference-card";
import { GeofenceRestrictionCard } from "@/features/security/components/geofence-restriction-card";
import { LoginEventList } from "@/features/security/components/login-event-list";
import { MfaEnrollment } from "@/features/security/components/mfa-enrollment";
import { SessionList } from "@/features/security/components/session-list";
import { TenantSessionList } from "@/features/security/components/tenant-session-list";
import { WorkingHoursRestrictionToggle } from "@/features/security/components/working-hours-restriction-toggle";
import { SecurityService } from "@/services/SecurityService";
import { TenantService } from "@/services/TenantService";
import { resolvePreferredFont } from "@/lib/branding/preferred-font";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Security | JMS Sales App",
};

/**
 * Phase 4c/4e/4f: security centre -- login_events + sessions + MFA
 * enrollment + working-hours restriction + geo-fencing/temporary-access
 * + download security (docs/05-authentication-security.md). Always
 * reachable (every signed-in user manages their own sessions/MFA
 * factor); the tenant-wide sections and every settings toggle only
 * render for security.manage/settings.manage holders respectively,
 * matching RLS's own gating on the underlying tables. MFA enrollment
 * doesn't need any data fetched here -- MfaEnrollment calls
 * supabase.auth.mfa.* directly against the caller's own session (see
 * its own header comment).
 *
 * `TenantSessionList` closes the "admin-driven forced termination"
 * gap tracked since 4c -- see SecurityService.forceSignOutUser's own
 * header comment for exactly what capability this is (account-wide,
 * timed) and isn't (one specific targeted session, which the Supabase
 * Admin API has no way to do).
 */
export default async function SecurityPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  const tenantId = tenant!.id;
  const [canManageSecurity, canManageSettings] = await Promise.all([
    can("security.manage", { tenantId }),
    can("settings.manage", { tenantId }),
  ]);
  const cookieStore = await cookies();
  const currentSessionId = cookieStore.get("sid")?.value ?? null;

  const securityService = new SecurityService(supabase);
  const tenantService = new TenantService(supabase);
  const [
    sessions,
    myEvents,
    tenantEvents,
    tenantSessions,
    workingHoursRestricted,
    geofenceRestricted,
    geofence,
    requireDownloadPasscode,
    hashedDownloadPasscode,
    preferredFont,
  ] = await Promise.all([
    securityService.listSessions(user!.id),
    securityService.listLoginEvents(user!.id),
    canManageSecurity ? securityService.listTenantLoginEvents(tenantId) : Promise.resolve([]),
    canManageSecurity ? securityService.listTenantSessions(tenantId) : Promise.resolve([]),
    canManageSettings
      ? tenantService.getSetting<boolean>(tenantId, "restrict_login_to_working_hours")
      : Promise.resolve(null),
    canManageSettings
      ? tenantService.getSetting<boolean>(tenantId, "restrict_login_to_geofence")
      : Promise.resolve(null),
    canManageSettings ? tenantService.getPrimaryLocationGeofence(tenantId) : Promise.resolve(null),
    canManageSettings
      ? tenantService.getSetting<boolean>(tenantId, "require_download_passcode")
      : Promise.resolve(null),
    canManageSettings
      ? tenantService.getSetting<string>(tenantId, "hashed_download_passcode")
      : Promise.resolve(null),
    resolvePreferredFont(supabase, user!.id),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="text-xl font-semibold">Security</h1>
      <FontPreferenceCard tenantSlug={tenantSlug} initialFont={preferredFont} />
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
      {canManageSettings && (
        <DownloadSecurityCard
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          initialEnabled={requireDownloadPasscode === true}
          passcodeConfigured={!!hashedDownloadPasscode}
        />
      )}
      <SessionList sessions={sessions} currentSessionId={currentSessionId} />
      <LoginEventList title="Your recent sign-ins" events={myEvents} />
      {canManageSecurity && (
        <TenantSessionList sessions={tenantSessions} tenantId={tenantId} tenantSlug={tenantSlug} currentUserId={user!.id} />
      )}
      {canManageSecurity && <LoginEventList title="Tenant-wide sign-in activity" events={tenantEvents} />}
    </div>
  );
}
