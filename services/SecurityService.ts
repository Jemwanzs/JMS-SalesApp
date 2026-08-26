import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { deviceLabel, parseDeviceType, parseUserAgent } from "@/lib/utils/user-agent";

/**
 * SecurityService — login_events + sessions (Phase 4c, docs/05-
 * authentication-security.md). Scoped to exactly login tracking and
 * session visibility/revocation, per the roadmap's own breakdown --
 * working-hours restriction, geo-fencing/temporary-access, download
 * security, and the full audit_logs coverage pass are separate, later
 * increments.
 *
 * All WRITES here (logLoginEvent, createSession, touchSession,
 * revokeSession, revokeOtherSessions, forceSignOutUser) MUST run on the
 * service-role client (migration 0016: both tables have RLS enabled with
 * a SELECT policy but zero write policies) -- login_events in particular
 * must be writable for a FAILED login attempt, which by definition has
 * no authenticated session for a self-scoped RLS insert policy to key
 * off of; forceSignOutUser specifically also needs service-role for
 * `supabase.auth.admin.*`, which only ever works under the service-role
 * key regardless of RLS. READS (listLoginEvents/listSessions/
 * listTenantSessions) work correctly on either client -- the RLS-
 * respecting client's SELECT policy already implements the right self-
 * or-security.manage visibility, service-role is only needed for callers
 * (like the sign-in action) that don't have an authenticated session yet.
 *
 * **Known limitation, now worked around rather than silently accepted**:
 * there is no way to revoke one SPECIFIC other session -- the supabase-js
 * admin API only exposes `admin.signOut(jwt)`, which needs the actual
 * token, not a session ID, and this project's own hard rule (docs/05)
 * forbids touching `auth.*` tables directly to work around that.
 * Self-service revocation of the CALLER's own other sessions is fully
 * real (`auth.signOut({scope: 'others'})`, which the SDK does support
 * for one's own session). For an ADMIN acting on a *different* user,
 * `forceSignOutUser` is the closest real capability the Admin API
 * actually offers: a short account-wide ban (`admin.updateUserById`,
 * `ban_duration`) that blocks every new sign-in and, within at most one
 * access-token lifetime, kills every live session too (GoTrue rejects
 * the next refresh-token exchange for a banned user) -- genuinely
 * broader than "one session," genuinely narrower and more reversible
 * than `UserService.setActive(false)` (Phase 4b, which blocks access
 * indefinitely until manually re-enabled). Both are real, honestly
 * distinct tools for different situations, not the same button twice.
 */
export interface LoginEventSummary {
  id: string;
  device: string;
  ip: string | null;
  success: boolean;
  failureReason: string | null;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  device: string;
  ip: string | null;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export class SecurityService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async logLoginEvent(input: {
    tenantId: string | null;
    profileId: string | null;
    ip: string | null;
    userAgent: string | null;
    success: boolean;
    failureReason?: string | null;
  }): Promise<void> {
    const { browser, os } = parseUserAgent(input.userAgent);

    const { error } = await this.supabase.from("login_events").insert({
      tenant_id: input.tenantId,
      profile_id: input.profileId,
      ip: input.ip,
      device: parseDeviceType(input.userAgent),
      browser,
      os,
      success: input.success,
      failure_reason: input.failureReason ?? null,
    });

    if (error) {
      throw new Error(`SecurityService.logLoginEvent: ${error.message}`);
    }
  }

  /**
   * Hardening roadmap Phase 2.1 (docs/22-hardening-roadmap.md): every
   * failed sign-in has always been written here, but nothing ever read
   * it back to actually throttle anything -- login was protected only by
   * whatever Supabase Auth's own project-wide default happens to be, not
   * anything tuned to this app or aware of which account is being
   * targeted. Two independent counts, not one: profileId catches
   * repeated guesses against ONE known account; ip catches a sweep
   * across many unknown/enumerated emails from one source, which a
   * profile-only check would never see (an unrecognized email never
   * resolves to a profileId at all -- see sign-in.ts's own
   * maybeProfile lookup). A sliding time window, not a permanent lock:
   * a permanent lockout keyed on failed attempts is itself an easy way
   * for an attacker to lock a real user out on purpose.
   */
  async countRecentFailedLogins(input: { profileId: string | null; ip: string | null; windowMinutes: number }): Promise<{
    byProfile: number;
    byIp: number;
  }> {
    const since = new Date(Date.now() - input.windowMinutes * 60 * 1000).toISOString();

    const [byProfile, byIp] = await Promise.all([
      input.profileId
        ? this.supabase
            .from("login_events")
            .select("id", { count: "exact", head: true })
            .eq("profile_id", input.profileId)
            .eq("success", false)
            .gte("created_at", since)
        : Promise.resolve({ count: 0 }),
      input.ip
        ? this.supabase
            .from("login_events")
            .select("id", { count: "exact", head: true })
            .eq("ip", input.ip)
            .eq("success", false)
            .gte("created_at", since)
        : Promise.resolve({ count: 0 }),
    ]);

    return { byProfile: byProfile.count ?? 0, byIp: byIp.count ?? 0 };
  }

  async createSession(input: {
    profileId: string;
    tenantId: string | null;
    ip: string | null;
    userAgent: string | null;
  }): Promise<{ sessionId: string }> {
    const { data, error } = await this.supabase
      .from("sessions")
      .insert({
        profile_id: input.profileId,
        tenant_id: input.tenantId,
        device_fingerprint: deviceLabel(input.userAgent),
        ip: input.ip,
        user_agent: input.userAgent,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`SecurityService.createSession: ${error?.message}`);
    }

    return { sessionId: data.id };
  }

  /**
   * RLS (login_events_select/sessions_select, migration 0016) already
   * restricts rows to the caller's own or, for a tenant-wide view,
   * holders of security.manage -- no separate permission check needed
   * for reads here.
   */
  async listLoginEvents(profileId: string, limit = 20): Promise<LoginEventSummary[]> {
    const { data, error } = await this.supabase
      .from("login_events")
      .select("id, device, browser, os, ip, success, failure_reason, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`SecurityService.listLoginEvents: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      device: describeDevice(row.browser, row.os),
      ip: row.ip,
      success: row.success,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * Tenant-wide view for security.manage holders -- RLS's login_events_
   * select already requires that grant for any row not the caller's own,
   * so a caller without it just gets an empty/self-only result rather
   * than an error.
   */
  async listTenantLoginEvents(tenantId: string, limit = 30): Promise<Array<LoginEventSummary & { who: string }>> {
    const { data, error } = await this.supabase
      .from("login_events")
      .select("id, profile_id, device, browser, os, ip, success, failure_reason, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`SecurityService.listTenantLoginEvents: ${error.message}`);
    }

    const profileIds = [...new Set((data ?? []).map((r) => r.profile_id).filter((id): id is string => !!id))];
    const { data: profiles } =
      profileIds.length > 0
        ? await this.supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
        : { data: [] as { id: string; full_name: string | null; email: string }[] };
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));

    return (data ?? []).map((row) => ({
      id: row.id,
      who: row.profile_id ? (nameById.get(row.profile_id) ?? "Unknown") : "Unknown email",
      device: describeDevice(row.browser, row.os),
      ip: row.ip,
      success: row.success,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
    }));
  }

  /**
   * Tenant-wide view for security.manage holders -- RLS's sessions_select
   * already requires that grant for any row not the caller's own, same
   * posture as listTenantLoginEvents. Only currently-active (non-revoked)
   * sessions, one row per session (not collapsed per profile) -- the
   * caller decides how to group/display them.
   */
  async listTenantSessions(tenantId: string): Promise<Array<SessionSummary & { profileId: string; who: string }>> {
    const { data, error } = await this.supabase
      .from("sessions")
      .select("id, profile_id, device_fingerprint, ip, last_seen_at, revoked_at, created_at")
      .eq("tenant_id", tenantId)
      .is("revoked_at", null)
      .order("last_seen_at", { ascending: false });

    if (error) {
      throw new Error(`SecurityService.listTenantSessions: ${error.message}`);
    }

    const profileIds = [...new Set((data ?? []).map((r) => r.profile_id))];
    const { data: profiles } =
      profileIds.length > 0 ? await this.supabase.from("profiles").select("id, full_name, email").in("id", profileIds) : { data: [] };
    const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email]));

    return (data ?? []).map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      who: nameById.get(row.profile_id) ?? "Unknown",
      device: row.device_fingerprint ?? "Unknown device",
      ip: row.ip,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }));
  }

  async listSessions(profileId: string): Promise<SessionSummary[]> {
    const { data, error } = await this.supabase
      .from("sessions")
      .select("id, device_fingerprint, ip, last_seen_at, revoked_at, created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`SecurityService.listSessions: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      device: row.device_fingerprint ?? "Unknown device",
      ip: row.ip,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }));
  }

  /**
   * Marks every OTHER session row for this profile as revoked (tracking
   * only -- see the class header's known-limitation note). Pair with a
   * real `auth.signOut({ scope: 'others' })` call in the caller, which
   * this service intentionally doesn't perform itself since that needs
   * the RLS-respecting client holding the caller's own live session, not
   * the service-role client this class's writes require.
   */
  async revokeOtherSessions(profileId: string, currentSessionId: string | null): Promise<void> {
    let query = this.supabase
      .from("sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: profileId, revoked_reason: "Signed out of other devices" })
      .eq("profile_id", profileId)
      .is("revoked_at", null);

    if (currentSessionId) {
      query = query.neq("id", currentSessionId);
    }

    const { error } = await query;
    if (error) {
      throw new Error(`SecurityService.revokeOtherSessions: ${error.message}`);
    }
  }

  /**
   * Admin-driven forced sign-out of a DIFFERENT user (docs/05: "sessions
   * ... with revoke capability (self-service and admin-driven)") -- the
   * real capability the Admin API actually offers, see this class's own
   * header comment for why it's account-wide/timed rather than a single
   * targeted session. A short ban (1 hour -- comfortably >= this
   * project's access-token lifetime) rather than an indefinite one:
   * the account recovers on its own once it expires, no separate
   * "un-ban" step an admin has to remember, unlike disabling a user.
   *
   * Every one of the target's tracked session rows is marked revoked,
   * not just the ones in the caller's own tenant -- the underlying ban
   * is account-wide (GoTrue rejects a refresh-token exchange from a
   * banned user regardless of which tenant they were last active in),
   * so tracking anything narrower would silently lie about sessions
   * that are, in fact, already dead.
   */
  async forceSignOutUser(profileId: string, tenantId: string, revokedBy: string): Promise<void> {
    const { data: membership } = await this.supabase
      .from("tenant_memberships")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!membership) {
      throw new Error("SecurityService.forceSignOutUser: that user is not a member of this tenant");
    }

    const { error: banError } = await this.supabase.auth.admin.updateUserById(profileId, { ban_duration: "1h" });
    if (banError) {
      throw new Error(`SecurityService.forceSignOutUser: ${banError.message}`);
    }

    const { error: revokeError } = await this.supabase
      .from("sessions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: revokedBy, revoked_reason: "Force-signed-out by an administrator" })
      .eq("profile_id", profileId)
      .is("revoked_at", null);

    if (revokeError) {
      throw new Error(`SecurityService.forceSignOutUser: ${revokeError.message}`);
    }
  }
}

function describeDevice(browser: string | null, os: string | null): string {
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
