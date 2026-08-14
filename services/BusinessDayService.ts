import type { SupabaseClient } from "@supabase/supabase-js";

import type { BusinessDayStatus, Database } from "@/types/database.types";

/**
 * BusinessDayService — owns the SCHEDULED -> OPEN -> CLOSED state
 * machine. See docs/09-business-day-engine.md.
 *
 * Manual open/close only in this increment — pg_cron auto open/close
 * (Phase 2f) and the MFA-gated reopen flow (Phase 2h, needs the
 * approval engine) are later work, not implemented here.
 */
export interface BusinessDay {
  id: string;
  businessDate: string;
  status: BusinessDayStatus;
  openedAt: string | null;
  closedAt: string | null;
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

  async getTodayBusinessDay(
    tenantId: string,
    locationId: string
  ): Promise<BusinessDay | null> {
    const businessDate = await this.todayInTimezone(locationId);

    const { data, error } = await this.supabase
      .from("business_days")
      .select("id, business_date, status, opened_at, closed_at, aggregates")
      .eq("tenant_id", tenantId)
      .eq("location_id", locationId)
      .eq("business_date", businessDate)
      .maybeSingle();

    if (error) {
      throw new Error(`BusinessDayService.getTodayBusinessDay: ${error.message}`);
    }

    return data ? toBusinessDay(data) : null;
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
          .select("id, business_date, status, opened_at, closed_at, aggregates")
          .single()
      : await this.supabase
          .from("business_days")
          .insert({
            tenant_id: tenantId,
            location_id: locationId,
            business_date: businessDate,
            ...payload,
          })
          .select("id, business_date, status, opened_at, closed_at, aggregates")
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
    const { data: sales } = await this.supabase
      .from("sales")
      .select("actual_amount")
      .eq("business_day_id", businessDayId)
      .neq("status", "voided");

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
      .select("id, business_date, status, opened_at, closed_at, aggregates")
      .single();

    if (error || !data) {
      throw new Error(`BusinessDayService.closeDay: ${error?.message}`);
    }

    return toBusinessDay(data);
  }

  async reopenDay(_businessDayId: string, _reason: string, _untilMinutes: number) {
    throw new Error(
      "BusinessDayService.reopenDay: not yet implemented (Phase 2h, needs the approval engine)"
    );
  }
}

function toBusinessDay(row: {
  id: string;
  business_date: string;
  status: BusinessDayStatus;
  opened_at: string | null;
  closed_at: string | null;
  aggregates: Record<string, unknown>;
}): BusinessDay {
  return {
    id: row.id,
    businessDate: row.business_date,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    aggregates: row.aggregates,
  };
}
