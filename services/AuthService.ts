import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * AuthService — sign up/in/out, password reset, the composed access
 * gate. Wraps Supabase Auth on the request-scoped, RLS-respecting
 * client (lib/supabase/server.ts) so session cookies are set correctly
 * via @supabase/ssr — never construct this with the service-role client
 * for these methods.
 *
 * evaluateAccessGate() is Phase 4e's first restriction (working-hours
 * login only, docs/05-authentication-security.md's `restrict_login_to_
 * working_hours` tenant setting) — geo-fencing and tenant-suspension
 * checks are later additions to this SAME gate, not a redesign, per the
 * doc's "single access-gate composition point" intent. Scoped to
 * *login-time* blocking only: the doc's other half ("a session nearing
 * the configured end time gets a countdown warning, then signs out") is
 * a client-side polling/timer concern, deliberately deferred rather than
 * built speculatively alongside the server-verifiable half.
 */
export interface SignUpResult {
  userId: string;
  emailConfirmationRequired: boolean;
}

export interface AccessGateResult {
  allowed: boolean;
  reason?: string;
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
  async evaluateAccessGate(input: { tenantId: string }): Promise<AccessGateResult> {
    const { data: setting } = await this.supabase
      .from("tenant_settings")
      .select("value")
      .eq("tenant_id", input.tenantId)
      .eq("setting_key", "restrict_login_to_working_hours")
      .maybeSingle();

    if (setting?.value !== true) {
      return { allowed: true };
    }

    const { data: location } = await this.supabase
      .from("locations")
      .select("id, timezone")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!location) {
      return { allowed: true };
    }

    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("timezone")
      .eq("id", input.tenantId)
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
      reason: closedAllDay
        ? "Login is restricted to business hours — this location is closed today."
        : `Login is restricted to business hours (${openTime!.slice(0, 5)}–${closeTime!.slice(0, 5)}).`,
    };
  }
}
