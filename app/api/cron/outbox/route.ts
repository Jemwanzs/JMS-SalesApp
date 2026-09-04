import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { AnniversaryService } from "@/services/AnniversaryService";
import { InsightsService } from "@/services/InsightsService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { PushNotificationService } from "@/services/PushNotificationService";
import { ReportService } from "@/services/ReportService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/**
 * Hardening roadmap Phase 1 (docs/22-hardening-roadmap.md): the previous
 * plain `!==` compared against `Bearer ${process.env.CRON_SECRET}` --
 * if CRON_SECRET were ever unset in a misconfigured environment, that
 * becomes a literal string comparison against "Bearer undefined", which
 * a request sending that exact header would pass. Fails closed (rejects
 * outright) when the secret isn't configured, and uses a length-checked
 * timingSafeEqual instead of `!==` for the real comparison.
 */
function isAuthorizedCronRequest(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authHeader);
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

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
 * InsightsService.evaluateDailyInsights (Phase 3d) and ReportService.
 * generateCorrectionsReport (Phase 3e) both run right after the daily
 * report succeeds, same "a business day just closed" trigger -- each
 * one's failure is caught separately and never undoes the report job's
 * success (the daily report is this job's actual deliverable; insights
 * and the corrections report are best-effort bonuses riding along on
 * the same event). generateCorrectionsReport itself returns null (not
 * an error) on an ordinary day with nothing voided/corrected.
 *
 * Phase 7d's anniversary wish scheduling/auto-sending (AnniversaryService)
 * also rides along on this same once-daily slot, for the same "one cron
 * job on this project's Hobby-plan Vercel Cron" reason report_jobs itself
 * does -- entirely unrelated to the report_jobs drain above, so its own
 * failure is caught independently and never affects report processing.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"))) {
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
      let reportId: string | null = null;
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

        try {
          await reportService.generateCorrectionsReport(businessDayId);
        } catch {
          // Same best-effort posture as insights above.
        }
      } else if (job.job_type === "push_daily_summary") {
        // Web Push (Feature 3): doesn't produce a `reports` row, so
        // report_id stays null for this job type -- see the completion
        // update below.
        const { business_day_id } = job.payload as { business_day_id: string };
        await new PushNotificationService(supabase).sendDailySummaryForTenant(job.tenant_id, business_day_id);
      } else {
        throw new Error(`Unknown report_jobs.job_type: ${job.job_type}`);
      }

      await supabase
        .from("report_jobs")
        .update({ status: "completed", ...(reportId ? { report_id: reportId } : {}) })
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

  // Best-effort, same posture as insights/corrections-report above --
  // this cron slot's real deliverable is the report_jobs drain; anniversary
  // scheduling/sending riding along on the same once-daily run must never
  // fail (or retry) that over an unrelated problem here.
  let anniversariesScheduled = 0;
  let anniversariesSent = 0;
  try {
    const anniversaryService = new AnniversaryService(supabase);
    anniversariesScheduled = (await anniversaryService.ensureScheduledForUpcoming()).scheduled;
    anniversariesSent = (await anniversaryService.sendDueAutomaticWishes()).sent;
  } catch {
    // best-effort
  }

  // Account Deletion (Feature 1): a self-service deletion request
  // (tenants.deletion_requested_at, migration 0063) becomes eligible
  // for permanent purge 30 days after it was made, unless cancelled.
  // Filters on `deletion_requested_at is not null` specifically, NOT
  // `status = 'deactivated'` alone -- a tenant a platform admin
  // deactivated for an unrelated reason (an investigation, suspicious
  // activity) must never be swept up here just because 30 days passed.
  // Reuses PlatformAdminService.deleteTenant directly rather than
  // reimplementing its cascading-delete + orphan-login-cleanup logic --
  // platformAdminId=null attributes the platform_audit_logs entry to
  // the system (migration 0062 widened that column to allow it), same
  // "null actor for an automatic action" convention audit_logs already
  // uses for BUSINESS_DAY_CLOSED. Each purge runs in its own try/catch,
  // same per-job isolation as the report_jobs loop above -- one
  // tenant's purge failing must never block another's.
  let purged = 0;
  let purgeFailed = 0;
  try {
    const platformAdminService = new PlatformAdminService(supabase);
    const graceCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const { data: expired } = await supabase
      .from("tenants")
      .select("id, name")
      .eq("status", "deactivated")
      .not("deletion_requested_at", "is", null)
      .lte("deletion_requested_at", graceCutoff);

    for (const tenant of expired ?? []) {
      try {
        await platformAdminService.deleteTenant(null, tenant.id, "Automatic purge: 30-day deletion grace period elapsed");
        purged += 1;
      } catch {
        purgeFailed += 1;
      }
    }
  } catch {
    // best-effort, same posture as the anniversary block above
  }

  return NextResponse.json({
    processed: jobs?.length ?? 0,
    completed,
    failed,
    retried,
    anniversariesScheduled,
    anniversariesSent,
    purged,
    purgeFailed,
  });
}
