import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AutoRelockResult,
  BusinessDayStatus,
  Database,
  ReopenBusinessDayResult,
} from "@/types/database.types";

const BUSINESS_DAY_SELECT = "id, business_date, status, opened_at, closed_at, reopen_expires_at, aggregates";

/**
 * BusinessDayService — owns the SCHEDULED -> OPEN -> CLOSED state
 * machine, plus CLOSED -> REOPENED -> CLOSED. See docs/09-business-day-engine.md.
 *
 * Manual open/close/reopen only — pg_cron auto open/close (Phase 2f) is
 * later work. Reopen (Phase 2h) is scoped per an explicit decision: reason
 * + optional approval (via the 2g engine), no MFA yet (Phase 4). The
 * bounded reopen window auto-relocks LAZILY — every getTodayBusinessDay()
 * call checks whether a "reopened" day's window has expired and, if so,
 * calls the auto_relock_expired_business_day() SQL function (migration
 * 0009) before returning — rather than waiting for 2f's pg_cron sweep to
 * exist. This is load-bearing correctness, not a stopgap: once 2f lands,
 * its sweep can call the same function proactively for timeliness, but
 * nothing here needs to change.
 */
export interface BusinessDay {
  id: string;
  businessDate: string;
  status: BusinessDayStatus;
  openedAt: string | null;
  closedAt: string | null;
  reopenExpiresAt: string | null;
  aggregates: Record<string, unknown>;
}

export class BusinessDayService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * "Today" per the location's effective timezone (location override,
   * falling back to the tenant's), never derived from UTC directly —
   * see docs/09-business-day-engine.md.
   */
  async getEffectiveTimezone(locationId: string): Promise<string> {
    const { data: location } = await this.supabase
      .from("locations")
      .select("timezone, tenant_id")
      .eq("id", locationId)
      .single();

    if (location?.timezone) {
      return location.timezone;
    }

    const { data: tenant } = await this.supabase
      .from("tenants")
      .select("timezone")
      .eq("id", location?.tenant_id ?? "")
      .maybeSingle();

    return tenant?.timezone ?? "UTC";
  }

  private async todayInTimezone(locationId: string): Promise<string> {
    const timezone = await this.getEffectiveTimezone(locationId);
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  }

  /**
   * Business Day Rollover & After-Midnight Sales: resolves which
   * business day is actually in effect right now, via the
   * resolve_effective_business_date() SQL function (migration 0055) --
   * the one place cross-midnight math (opening/closing hours that cross
   * into the next calendar day) is computed, mirrored from
   * run_business_day_sweep()'s own math so the two can't drift apart.
   * Always returns exactly one row (never null/empty) -- see that
   * function's own header comment for its three cases (still within
   * yesterday's extended window / within today's window / the gap,
   * defaulting to the most recently closed day).
   */
  private async resolveEffectiveBusinessDate(
    tenantId: string,
    locationId: string
  ): Promise<{ businessDate: string; isLive: boolean; businessDayId: string | null }> {
    const { data, error } = await this.supabase.rpc("resolve_effective_business_date", {
      p_tenant_id: tenantId,
      p_location_id: locationId,
    });

    const row = (data ?? [])[0];
    if (error || !row) {
      throw new Error(`BusinessDayService.resolveEffectiveBusinessDate: ${error?.message ?? "no row returned"}`);
    }

    return { businessDate: row.business_date, isLive: row.is_live, businessDayId: row.business_day_id };
  }

  /**
   * The currently OPEN business day, if any -- what sales/page.tsx gates
   * `canCapture` on, and what reports/page.tsx's live-vs-final label
   * depends on. Deliberately returns null during the gap between one
   * business day closing and the next opening (e.g. 03:00-07:00 for a
   * 07:00-03:00 tenant) -- you can't capture a sale outside configured
   * hours, so there is genuinely no "open today" to return then, matching
   * resolve_effective_business_date()'s `is_live` signal exactly. For a
   * DISPLAY/reporting default that should keep showing the most recently
   * completed day during that same gap instead of going blank, use
   * getEffectiveBusinessDate() below instead.
   */
  async getTodayBusinessDay(
    tenantId: string,
    locationId: string
  ): Promise<BusinessDay | null> {
    const resolved = await this.resolveEffectiveBusinessDate(tenantId, locationId);
    if (!resolved.isLive || !resolved.businessDayId) {
      return null;
    }

    const { data, error } = await this.supabase
      .from("business_days")
      .select(BUSINESS_DAY_SELECT)
      .eq("id", resolved.businessDayId)
      .maybeSingle();

    if (error) {
      throw new Error(`BusinessDayService.getTodayBusinessDay: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    if (
      data.status === "reopened" &&
      data.reopen_expires_at &&
      new Date(data.reopen_expires_at) <= new Date()
    ) {
      const { data: relockResult, error: relockError } = await this.supabase.rpc(
        "auto_relock_expired_business_day",
        { p_business_day_id: data.id }
      );

      if (relockError) {
        throw new Error(`BusinessDayService.getTodayBusinessDay: ${relockError.message}`);
      }

      if ((relockResult as AutoRelockResult | null)?.relocked) {
        // Re-fetch rather than patching `data` locally -- the relock
        // recomputed `aggregates` in the database (to include any sales
        // recorded during the reopened window), and returning the
        // pre-relock `data` here would silently show stale figures even
        // though the row itself is correct.
        const { data: refetched, error: refetchError } = await this.supabase
          .from("business_days")
          .select(BUSINESS_DAY_SELECT)
          .eq("id", data.id)
          .single();

        if (refetchError || !refetched) {
          throw new Error(`BusinessDayService.getTodayBusinessDay: ${refetchError?.message}`);
        }

        return toBusinessDay(refetched);
      }
    }

    return toBusinessDay(data);
  }

  /**
   * The business date READ/DISPLAY defaults (Sales History, Analytics,
   * Reports, Leaderboards/product ranking, Expenses, Stock) should show
   * "today" as -- unlike getTodayBusinessDay() above, this does NOT go
   * blank during the gap between one business day closing and the next
   * opening: it keeps returning the most recently completed day
   * (`isLive: false`) so those screens keep showing real data instead of
   * an empty state just because the calendar rolled over or hours
   * haven't opened yet. See resolve_effective_business_date()'s own
   * header comment (migration 0055) for the exact resolution order.
   */
  async getEffectiveBusinessDate(
    tenantId: string,
    locationId: string
  ): Promise<{ date: string; isLive: boolean }> {
    const resolved = await this.resolveEffectiveBusinessDate(tenantId, locationId);
    return { date: resolved.businessDate, isLive: resolved.isLive };
  }

  async openDay(
    tenantId: string,
    locationId: string,
    openedBy: string,
    reason?: string
  ): Promise<BusinessDay> {
    const businessDate = await this.todayInTimezone(locationId);
    const existing = await this.getTodayBusinessDay(tenantId, locationId);

    if (existing && existing.status !== "scheduled") {
      throw new Error(
        `BusinessDayService.openDay: today's business day is already "${existing.status}"`
      );
    }

    const payload = {
      status: "open" as const,
      opened_at: new Date().toISOString(),
      opened_by: openedBy,
      opening_reason: reason ?? null,
    };

    const { data, error } = existing
      ? await this.supabase
          .from("business_days")
          .update(payload)
          .eq("id", existing.id)
          .select(BUSINESS_DAY_SELECT)
          .single()
      : await this.supabase
          .from("business_days")
          .insert({
            tenant_id: tenantId,
            location_id: locationId,
            business_date: businessDate,
            ...payload,
          })
          .select(BUSINESS_DAY_SELECT)
          .single();

    if (error || !data) {
      throw new Error(`BusinessDayService.openDay: ${error?.message}`);
    }

    return toBusinessDay(data);
  }

  async closeDay(
    businessDayId: string,
    closedBy: string,
    reason?: string
  ): Promise<BusinessDay> {
    // Excludes 'corrected' too, not just 'voided' -- see
    // AnalyticsService.getAnalytics's own comment on this exact filter
    // for why (a corrected sale's original amount is stale, replaced by
    // its already-included replacement row).
    const { data: sales } = await this.supabase
      .from("sales")
      .select("actual_amount")
      .eq("business_day_id", businessDayId)
      .neq("status", "voided")
      .neq("status", "corrected");

    const grossSales = (sales ?? []).reduce((sum, s) => sum + Number(s.actual_amount), 0);
    const transactionCount = sales?.length ?? 0;

    const { data, error } = await this.supabase
      .from("business_days")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        closed_by: closedBy,
        closing_reason: reason ?? null,
        aggregates: { grossSales, transactionCount },
      })
      .eq("id", businessDayId)
      .select(BUSINESS_DAY_SELECT)
      .single();

    if (error || !data) {
      throw new Error(`BusinessDayService.closeDay: ${error?.message}`);
    }

    // Manual close reuses the exact same outbox trigger the pg_cron sweep
    // uses on auto-close (migration 0011) -- daily report/insights
    // generation shouldn't depend on which path closed the day.
    // report_jobs has RLS enabled with zero policies (only the service-
    // role outbox worker writes it directly), so this goes through the
    // queue_daily_report_job() SECURITY DEFINER function (migration
    // 0015) instead of an insert this RLS-respecting client couldn't
    // perform. Best-effort: a failed enqueue doesn't fail the close
    // itself -- the day is already closed by this point.
    const { error: queueError } = await this.supabase.rpc("queue_daily_report_job", {
      p_business_day_id: businessDayId,
    });
    if (queueError) {
      console.error(`BusinessDayService.closeDay: failed to queue report_jobs: ${queueError.message}`);
    }

    return toBusinessDay(data);
  }

  async reopenDay(
    businessDayId: string,
    reason: string,
    until: Date
  ): Promise<ReopenBusinessDayResult> {
    const { data, error } = await this.supabase.rpc("reopen_business_day", {
      p_business_day_id: businessDayId,
      p_reason: reason,
      p_until: until.toISOString(),
    });

    if (error || !data) {
      throw new Error(`BusinessDayService.reopenDay: ${error?.message}`);
    }

    return data;
  }
}

function toBusinessDay(row: {
  id: string;
  business_date: string;
  status: BusinessDayStatus;
  opened_at: string | null;
  closed_at: string | null;
  reopen_expires_at: string | null;
  aggregates: Record<string, unknown>;
}): BusinessDay {
  return {
    id: row.id,
    businessDate: row.business_date,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    reopenExpiresAt: row.reopen_expires_at,
    aggregates: row.aggregates,
  };
}
