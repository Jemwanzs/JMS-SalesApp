import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * AnalyticsService — KPI queries, date-range analytics, rule-based
 * insights engine. Every report method must document whether it labels
 * results using a sale's product_name_snapshot (historical accuracy) or
 * the product's current catalog name (aggregate grouping) — they can
 * legitimately differ. See docs/11-analytics-reports.md and
 * docs/08-sales-engine.md's snapshot-vs-current decision log.
 *
 * The analytics.date_range/past_dates permission check happens at the
 * query-parameter level here, not purely in RLS — RLS still enforces
 * tenant isolation on the underlying sales rows regardless.
 *
 * Not yet implemented — Phase 3.
 */
export class AnalyticsService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async getKpis(_tenantId: string, _dateRange: { from: string; to: string }) {
    throw new Error("AnalyticsService.getKpis: not yet implemented (Phase 3b)");
  }
}
