import { NextResponse } from "next/server";

import { InsightsService } from "@/services/InsightsService";
import { ReportService } from "@/services/ReportService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/**
 * Drains the report_jobs outbox (docs/09-business-day-engine.md's
 * "pg_cron for state, Vercel Cron for side effects" split): the sweep
 * (migration 0011's run_business_day_sweep) only ever INSERTs a pending
 * row here, from inside the same transaction as a business-day close --
 * it never calls Resend/report generation directly from SQL. This route
 * is the independent, retryable worker that actually does that work.
 *
 * Triggered by Vercel Cron (configured in vercel.json) with `CRON_SECRET`
 * as a bearer token, so it can't be invoked by arbitrary public requests.
 * Runs as the service-role client -- report_jobs has RLS enabled with no
 * policies at all (see migration 0011), so nothing else can read it.
 *
 * ReportService.generateDailyReport (Phase 3c) is real -- a successful
 * run links the job to the `reports` row it produced. Email delivery via
 * Resend is NOT wired yet (deliberately deferred, same as the
 * notifications fan-out itself -- see migration 0011's header): a
 * completed job means the report was generated and stored, not that
 * anyone was emailed about it.
 *
 * InsightsService.evaluateDailyInsights (Phase 3d) runs right after a
 * daily report succeeds, same "a business day just closed" trigger --
 * its own failure is caught separately and never undoes the report
 * job's success (the report is this job's actual deliverable; insights
 * are a best-effort bonus riding along on the same event).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const reportService = new ReportService(supabase);
  const insightsService = new InsightsService(supabase);

  const { data: jobs, error } = await supabase
    .from("report_jobs")
    .select("id, tenant_id, job_type, payload, attempts")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let completed = 0;
  let failed = 0;
  let retried = 0;

  for (const job of jobs ?? []) {
    await supabase.from("report_jobs").update({ status: "running" }).eq("id", job.id);

    try {
      let reportId: string;
      if (job.job_type === "daily_business_day_report") {
        const businessDayId = (job.payload as { business_day_id: string }).business_day_id;
        reportId = await reportService.generateDailyReport(businessDayId);

        try {
          await insightsService.evaluateDailyInsights(businessDayId);
        } catch {
          // Best-effort -- insights are a bonus on top of the report,
          // not this job's deliverable. Swallowed rather than failing
          // (and retrying) an otherwise-successful report job over it.
        }
      } else {
        throw new Error(`Unknown report_jobs.job_type: ${job.job_type}`);
      }

      await supabase
        .from("report_jobs")
        .update({ status: "completed", report_id: reportId })
        .eq("id", job.id);
      completed += 1;
    } catch (err) {
      const attempts = job.attempts + 1;
      const lastError = err instanceof Error ? err.message : "Unknown error";
      const nextStatus = attempts >= MAX_ATTEMPTS ? "failed" : "pending";

      await supabase
        .from("report_jobs")
        .update({ status: nextStatus, attempts, last_error: lastError })
        .eq("id", job.id);

      if (nextStatus === "failed") {
        failed += 1;
      } else {
        retried += 1;
      }
    }
  }

  return NextResponse.json({ processed: jobs?.length ?? 0, completed, failed, retried });
}
