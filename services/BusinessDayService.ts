import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * BusinessDayService — owns the SCHEDULED -> OPEN -> CLOSING -> CLOSED
 * (-> REOPENED -> CLOSED) state machine that the pg_cron sweep, the sale
 * insert guard, and the approval-engine reopen flow all depend on. See
 * docs/09-business-day-engine.md.
 *
 * The pg_cron sweep calls the same close/open logic this service exposes
 * (via a SQL function it owns) — never a parallel implementation.
 *
 * Not yet implemented — Phase 2b (manual open/close), Phase 2f (auto
 * sweep), Phase 2h (reopen).
 */
export class BusinessDayService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async openDay(_tenantId: string, _locationId: string, _reason?: string) {
    throw new Error("BusinessDayService.openDay: not yet implemented (Phase 2b)");
  }

  async closeDay(_businessDayId: string, _reason?: string) {
    throw new Error("BusinessDayService.closeDay: not yet implemented (Phase 2b)");
  }

  async reopenDay(_businessDayId: string, _reason: string, _untilMinutes: number) {
    throw new Error(
      "BusinessDayService.reopenDay: not yet implemented (Phase 2h)"
    );
  }
}
