import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * ReportService — scheduled report generation (daily/weekly/monthly/
 * custom), corrections/void reports. Reports are produced by the outbox-
 * drain worker (app/api/cron/outbox), never generated synchronously
 * inside the pg_cron sweep transaction. See docs/09-business-day-engine.md
 * and docs/11-analytics-reports.md.
 *
 * Not yet implemented — Phase 3d.
 */
export class ReportService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async generateDailyReport(_businessDayId: string) {
    throw new Error(
      "ReportService.generateDailyReport: not yet implemented (Phase 3d)"
    );
  }
}
