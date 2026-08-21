import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, RequestTemporaryAccessResult } from "@/types/database.types";
import { haversineDistanceMeters } from "@/lib/utils/geo";

/**
 * AuthService — sign up/in/out, password reset, the composed access
 * gate. Wraps Supabase Auth on the request-scoped, RLS-respecting
 * client (lib/supabase/server.ts) so session cookies are set correctly
 * via @supabase/ssr — never construct this with the service-role client
 * for these methods.
 *
 * evaluateAccessGate() is the single access-gate composition point docs/
 * 05-authentication-security.md calls for: 4e added working-hours login
 * restriction (`restrict_login_to_working_hours`), this increment adds
 * geo-fencing (`restrict_login_to_geofence`) as a second, independent
 * check in the SAME gate rather than a parallel one — tenant-suspension
 * is a later addition to this same function, not a redesign. Scoped to
 * *login-time* blocking only: the doc's "session nearing the configured
 * end time gets a countdown warning, then signs out" language (for both
 * working-hours and, by extension, an expiring temporary-access grant)
 * is a client-side polling/timer concern, deliberately deferred rather
 * than built speculatively alongside the server-verifiable half.
 *
 * Product Enhancements follow-up: whoever holds settings.manage for the
 * tenant -- the SAME permission that gates turning these two toggles on
 * in the first place (TenantService.setSetting's docblock) -- is exempt
 * from a block either check would otherwise produce, so the person who
 * configured "restrict everyone to business hours/the workplace" isn't
 * locked out by their own toggle. Deliberately reuses settings.manage
 * rather than a new permission: it's already scoped to Tenant
 * Administrator by default (RoleService.DEFAULT_ROLE_GRANTS) and stays
 * correct automatically if a tenant customizes who holds it. Checked
 * ONLY when a block would otherwise fire (not on every login) so an
 * ordinary, unrestricted sign-in never pays for the extra permissions
 * round trip.
 *
 * requestTemporaryAccess() is the geo-fencing escape hatch (docs/05's
 * "Temporary access requests" section, the Approval Engine's second
 * consumer after migration 0006's void/correct/reopen). It must run
 * under an authenticated session (the SECURITY DEFINER function keys off
 * auth.uid()) — callers use it inside the same transient
 * sign-in-then-sign-out window sign-in.ts already establishes for the
 * gate check itself, never against a session that already passed the
 * gate.
 */
export interface SignUpResult {
  userId: string;
  emailConfirmationRequired: boolean;
}

export interface AccessGateResult {
  allowed: boolean;
  reason?: string;
  blockedBy?: "working_hours" | "geofence";
  /** True when this login would otherwise have been blocked by
   * blockedBy, but the caller holds settings.manage and was let through
   * anyway -- callers use this to show a one-time "you're exempt as an
   * admin" notice. */
  bypassed?: boolean;
}

export class AuthService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async signUp(input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone: string;
  }): Promise<SignUpResult> {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const { data, error } = await this.supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: `${appUrl}/api/auth/callback?next=/login`,
        data: {
          full_name: `${input.firstName} ${input.lastName}`.trim(),
          first_name: input.firstName,
          last_name: input.lastName,
          phone: input.phone,
        },
      },
    });

    if (error || !data.user) {
      throw new Error(`AuthService.signUp: ${error?.message ?? "unknown error"}`);
    }

    // full_name and phone are captured from raw_user_meta_data by the
    // handle_new_auth_user trigger (supabase/migrations/0001 + 0003) as
    // part of the same transaction that creates the auth.users row --
    // deliberately not a separate update call here, since there's no
    // authenticated session yet when email confirmation is required (the
    // profiles_update_own RLS policy would silently block it).
    return {
      userId: data.user.id,
      emailConfirmationRequired: !data.session,
    };
  }

  async signIn(input: { email: string; password: string }) {
    const { data, error } = await this.supabase.auth.signInWithPassword(input);

    if (error || !data.user) {
      throw new Error(`AuthService.signIn: ${error?.message ?? "unknown error"}`);
    }

    return { userId: data.user.id };
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();

    if (error) {
      throw new Error(`AuthService.signOut: ${error.message}`);
    }
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      throw new Error(`AuthService.requestPasswordReset: ${error.message}`);
    }
  }

  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      throw new Error(`AuthService.updatePassword: ${error.message}`);
    }
  }

  /**
   * Resolves the tenant's first location (Phase 1's one-location-per-
   * tenant reality, same simplification `sales/page.tsx` already makes)
   * rather than taking a locationId param -- at login time the caller
   * doesn't have one to pass yet anyway.
   */
  async evaluateAccessGate(input: {
    tenantId: string;
    profileId: string;
    latitude?: number | null;
    longitude?: number | null;
  }): Promise<AccessGateResult> {
    const { data: settingRows } = await this.supabase
      .from("tenant_settings")
      .select("setting_key, value")
      .eq("tenant_id", input.tenantId)
      .in("setting_key", ["restrict_login_to_working_hours", "restrict_login_to_geofence"]);

    const workingHoursRestricted =
      settingRows?.find((r) => r.setting_key === "restrict_login_to_working_hours")?.value === true;
    const geofenceRestricted =
      settingRows?.find((r) => r.setting_key === "restrict_login_to_geofence")?.value === true;

    if (!workingHoursRestricted && !geofenceRestricted) {
      return { allowed: true };
    }

    const { data: location } = await this.supabase
      .from("locations")
      .select("id, timezone, lat, long, geofence_radius_m")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!location) {
      return { allowed: true };
    }

    let blocked: AccessGateResult | null = null;

    if (workingHoursRestricted) {
      const gate = await this.checkWorkingHours(input.tenantId, location);
      if (!gate.allowed) blocked = gate;
    }

    if (!blocked && geofenceRestricted) {
      const gate = await this.checkGeofence(input, location);
      if (!gate.allowed) blocked = gate;
    }

    if (!blocked) {
      return { allowed: true };
    }

    const { data: permissions } = await this.supabase.rpc("get_my_permissions", {
      p_tenant_id: input.tenantId,
    });
    const isExempt = (permissions ?? []).some((p) => p.permission_key === "settings.manage");

    return isExempt ? { ...blocked, allowed: true, bypassed: true } : blocked;
  }

  private async checkWorkingHours(
    tenantId: string,
    location: { id: string; timezone: string | null }
  ): Promise<AccessGateResult> {
    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("timezone")
      .eq("id", tenantId)
      .maybeSingle();
    const timezone = location.timezone ?? tenant?.timezone ?? "UTC";

    const now = new Date();
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
    const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
    const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
    const currentTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);

    const [{ data: special }, { data: weekly }] = await Promise.all([
      this.supabase
        .from("special_hours")
        .select("is_closed, open_time, close_time")
        .eq("location_id", location.id)
        .eq("date", localDate)
        .maybeSingle(),
      this.supabase
        .from("location_hours")
        .select("open_time, close_time, closed_all_day")
        .eq("location_id", location.id)
        .eq("day_of_week", dayOfWeek)
        .maybeSingle(),
    ]);

    const closedAllDay = special?.is_closed ?? weekly?.closed_all_day ?? false;
    const openTime = special?.open_time ?? weekly?.open_time ?? null;
    const closeTime = special?.close_time ?? weekly?.close_time ?? null;

    // No hours configured for today at all -- fail OPEN (allow), since
    // this is a data gap, not a deliberate closure the tenant asked to
    // restrict against; only an explicit closed_all_day/is_closed (or a
    // real open/close window the current time falls outside) blocks.
    if (!closedAllDay && (!openTime || !closeTime)) {
      return { allowed: true };
    }

    // Compared as minutes-since-midnight, not strings -- an overnight
    // window (e.g. open 22:00, close 02:00) has closeMinutes <
    // openMinutes, which breaks a naive lexicographic string comparison
    // (same overnight-wrap reasoning run_business_day_sweep() already
    // applies in SQL via `if close <= open then close += 1 day`, just
    // expressed as integer minutes here instead of timestamps).
    const toMinutes = (hhmm: string) => {
      const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
      return h * 60 + m;
    };
    const currentMinutes = toMinutes(currentTime);
    const openMinutes = toMinutes(openTime!);
    const closeMinutes = toMinutes(closeTime!);
    const isOvernight = closeMinutes <= openMinutes;

    const withinHours =
      !closedAllDay &&
      (isOvernight
        ? currentMinutes >= openMinutes || currentMinutes <= closeMinutes
        : currentMinutes >= openMinutes && currentMinutes <= closeMinutes);

    if (withinHours) {
      return { allowed: true };
    }

    return {
      allowed: false,
      blockedBy: "working_hours",
      reason: closedAllDay
        ? "Login is restricted to business hours — this location is closed today."
        : `Login is restricted to business hours (${openTime!.slice(0, 5)}–${closeTime!.slice(0, 5)}).`,
    };
  }

  /**
   * An approved temporary_access_requests grant bypasses the fence
   * entirely for its window (checked first, before even looking at
   * coordinates) -- that's the whole point of the grant. Missing
   * coordinates (geolocation denied/unavailable) and coordinates outside
   * the configured radius are both blocked, with the SAME reason/
   * blockedBy shape, so the client always knows to offer "Request
   * Temporary Access" without needing to distinguish the two cases.
   */
  private async checkGeofence(
    input: { tenantId: string; profileId: string; latitude?: number | null; longitude?: number | null },
    location: { lat: number | null; long: number | null; geofence_radius_m: number | null }
  ): Promise<AccessGateResult> {
    const { data: grant } = await this.supabase
      .from("temporary_access_requests")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("profile_id", input.profileId)
      .eq("status", "approved")
      .gt("granted_until", new Date().toISOString())
      .limit(1)
      .maybeSingle();

    if (grant) {
      return { allowed: true };
    }

    // No fence configured for this location at all -- fail OPEN (data
    // gap, not a deliberate restriction), same convention as the
    // working-hours "no hours configured today" case.
    if (location.lat == null || location.long == null || location.geofence_radius_m == null) {
      return { allowed: true };
    }

    const blocked: AccessGateResult = {
      allowed: false,
      blockedBy: "geofence",
      reason: "Sign-in is restricted to your workplace location.",
    };

    if (input.latitude == null || input.longitude == null) {
      return blocked;
    }

    const distanceMeters = haversineDistanceMeters(location.lat, location.long, input.latitude, input.longitude);
    if (distanceMeters > location.geofence_radius_m) {
      return blocked;
    }

    return { allowed: true };
  }

  /**
   * docs/05's "Temporary access requests" flow -- the geo-fencing escape
   * hatch. Must be called while an authenticated session is live (the
   * underlying SECURITY DEFINER function keys off auth.uid()); see
   * features/auth/actions/request-temporary-access.ts for the transient
   * sign-in-then-sign-out window that provides one.
   */
  async requestTemporaryAccess(input: {
    tenantId: string;
    reason: string;
    latitude: number | null;
    longitude: number | null;
    durationMinutes: number;
  }): Promise<RequestTemporaryAccessResult> {
    const { data, error } = await this.supabase.rpc("request_temporary_access", {
      p_tenant_id: input.tenantId,
      p_reason: input.reason,
      p_current_latitude: input.latitude,
      p_current_longitude: input.longitude,
      p_duration_minutes: input.durationMinutes,
    });

    if (error || !data) {
      throw new Error(`AuthService.requestTemporaryAccess: ${error?.message ?? "unknown error"}`);
    }

    return data;
  }
}
