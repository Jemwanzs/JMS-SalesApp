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
 * revokeSession, revokeOtherSessions) MUST run on the service-role
 * client (migration 0016: both tables have RLS enabled with a SELECT
 * policy but zero write policies) -- login_events in particular must be
 * writable for a FAILED login attempt, which by definition has no
 * authenticated session for a self-scoped RLS insert policy to key off
 * of. READS (listLoginEvents/listSessions) work correctly on either
 * client -- the RLS-respecting client's SELECT policy already implements
 * the right self-or-security.manage visibility, service-role is only
 * needed for callers (like the sign-in action) that don't have an
 * authenticated session yet.
 *
 * **Known limitation, not silently glossed over**: `revokeSession`/
 * `revokeOtherSessions` mark our own tracking rows as revoked (a real,
 * useful audit trail) but do NOT forcibly invalidate another user's live
 * Supabase Auth JWT elsewhere -- the supabase-js admin API only exposes
 * `admin.signOut(jwt)`, which needs the actual token, not a session ID,
 * and this project's own hard rule (docs/05) forbids touching `auth.*`
 * tables directly to work around that. Self-service revocation of the
 * CALLER's own other sessions is fully real (uses `auth.signOut({scope:
 * 'others'})`, which the SDK does support for one's own session).
 * Admin-driven forced termination of a specific *other* session remains
 * an explicit gap -- `UserService.setActive(false)` (Phase 4b) is the
 * mechanism that actually blocks a disabled user's access reliably.
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
}

function describeDevice(browser: string | null, os: string | null): string {
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}
