import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

const WISH_MODE_SETTING_KEY = "anniversary_wish_mode";
export type AnniversaryWishMode = "automatic" | "review" | "disabled";

export interface UpcomingAnniversary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  anniversaryDate: string;
  nextOccurrence: string;
  daysUntil: number;
  yearsCount: number;
  wishMode: AnniversaryWishMode;
}

export interface AnniversaryWishView {
  id: string;
  tenantId: string;
  tenantName: string;
  year: number;
  mode: AnniversaryWishMode;
  status: "pending" | "sent" | "skipped";
  scheduledFor: string;
  sentAt: string | null;
  message: string;
}

/**
 * AnniversaryService — business anniversary tracking + automated wishes
 * (docs/15-super-admin.md's "Business anniversaries" section).
 * `tenants.anniversary_date` (migration 0001) is already set by tenants
 * themselves during onboarding (TenantService.updateBusinessDetails) --
 * this service owns the wish-scheduling/sending side (migration 0025).
 *
 * "Never forced on a tenant that hasn't opted in": getWishMode()
 * defaults a tenant with no `anniversary_wish_mode` tenant_settings row
 * to 'disabled', explicitly, not to 'automatic' as a convenience default.
 *
 * Real message DELIVERY (an actual email/SMS) needs Resend, which isn't
 * wired in this app yet -- same deferral as every other Resend-dependent
 * feature this session (docs/13-notifications.md). "Sending" a wish here
 * means marking it sent and making it queryable by the tenant's own app
 * (RLS-respecting reads, is_tenant_member-gated) -- a real, visible
 * result today, not a placeholder, that a future Resend integration
 * would extend rather than replace.
 *
 * Scheduling/auto-sending run from the service-role client (the daily
 * cron sweep, app/api/cron/outbox/route.ts); reading a tenant's own
 * wishes and setting the wish-mode preference are RLS-respecting-client-
 * safe (anniversary_wishes_select is is_tenant_member-gated;
 * tenant_settings writes are settings.manage-gated already).
 */
export class AnniversaryService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async getWishMode(tenantId: string): Promise<AnniversaryWishMode> {
    const { data } = await this.supabase
      .from("tenant_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("setting_key", WISH_MODE_SETTING_KEY)
      .maybeSingle();

    const mode = data?.value as AnniversaryWishMode | undefined;
    return mode === "automatic" || mode === "review" ? mode : "disabled";
  }

  async setWishMode(tenantId: string, mode: AnniversaryWishMode, updatedBy: string): Promise<void> {
    const { error } = await this.supabase
      .from("tenant_settings")
      .upsert(
        { tenant_id: tenantId, setting_key: WISH_MODE_SETTING_KEY, value: mode, updated_by: updatedBy },
        { onConflict: "tenant_id,setting_key" }
      );

    if (error) {
      throw new Error(`AnniversaryService.setWishMode: ${error.message}`);
    }
  }

  /** Platform Admin dashboard's "surfaces upcoming anniversaries" -- every tenant with an anniversary_date, sorted soonest-first. */
  async listUpcoming(withinDays = 30): Promise<UpcomingAnniversary[]> {
    const { data: tenants } = await this.supabase
      .from("tenants")
      .select("id, name, slug, anniversary_date")
      .not("anniversary_date", "is", null);

    const { data: settings } = await this.supabase
      .from("tenant_settings")
      .select("tenant_id, value")
      .eq("setting_key", WISH_MODE_SETTING_KEY);
    const modeByTenant = new Map((settings ?? []).map((s) => [s.tenant_id, s.value as AnniversaryWishMode]));

    const now = new Date();
    const upcoming: UpcomingAnniversary[] = [];

    for (const t of tenants ?? []) {
      if (!t.anniversary_date) continue;
      const { date, yearsCount } = nextOccurrence(t.anniversary_date, now);
      const daysUntil = Math.round((date.getTime() - startOfDay(now).getTime()) / 86_400_000);
      if (daysUntil > withinDays) continue;

      const mode = modeByTenant.get(t.id);
      upcoming.push({
        tenantId: t.id,
        tenantName: t.name,
        tenantSlug: t.slug,
        anniversaryDate: t.anniversary_date,
        nextOccurrence: date.toISOString().slice(0, 10),
        daysUntil,
        yearsCount,
        wishMode: mode === "automatic" || mode === "review" ? mode : "disabled",
      });
    }

    return upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  /**
   * Idempotent (unique(tenant_id, year) backstops it even under a
   * concurrent double-run) -- for every tenant whose next anniversary is
   * within `withinDays` and whose wish mode isn't 'disabled', schedules
   * one anniversary_wishes row for that occurrence if one doesn't
   * already exist. Called from the daily cron sweep, best-effort.
   */
  async ensureScheduledForUpcoming(withinDays = 7): Promise<{ scheduled: number }> {
    const upcoming = await this.listUpcoming(withinDays);
    let scheduled = 0;

    for (const u of upcoming) {
      if (u.wishMode === "disabled") continue;

      const occurrenceYear = Number(u.nextOccurrence.slice(0, 4));
      const { data: existing } = await this.supabase
        .from("anniversary_wishes")
        .select("id")
        .eq("tenant_id", u.tenantId)
        .eq("year", occurrenceYear)
        .maybeSingle();
      if (existing) continue;

      const { error } = await this.supabase.from("anniversary_wishes").insert({
        tenant_id: u.tenantId,
        year: occurrenceYear,
        mode: u.wishMode,
        scheduled_for: u.nextOccurrence,
        message: defaultWishMessage(u.tenantName, u.yearsCount),
      });
      if (!error) scheduled += 1;
    }

    return { scheduled };
  }

  /** For 'automatic' mode: due, still-pending rows get marked sent -- the actual "delivery" is becoming tenant-queryable, per this service's own header comment. */
  async sendDueAutomaticWishes(): Promise<{ sent: number }> {
    const today = new Date().toISOString().slice(0, 10);
    const { data: due } = await this.supabase
      .from("anniversary_wishes")
      .select("id")
      .eq("mode", "automatic")
      .eq("status", "pending")
      .lte("scheduled_for", today);

    if (!due || due.length === 0) return { sent: 0 };

    const { error } = await this.supabase
      .from("anniversary_wishes")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in(
        "id",
        due.map((d) => d.id)
      );

    return { sent: error ? 0 : due.length };
  }

  /** Platform Admin's "Review Before Sending" queue. */
  async listPendingReviews(): Promise<AnniversaryWishView[]> {
    const { data: wishes } = await this.supabase
      .from("anniversary_wishes")
      .select("id, tenant_id, year, mode, status, scheduled_for, sent_at, message")
      .eq("mode", "review")
      .eq("status", "pending")
      .order("scheduled_for", { ascending: true });

    const tenantIds = [...new Set((wishes ?? []).map((w) => w.tenant_id))];
    const { data: tenants } =
      tenantIds.length > 0 ? await this.supabase.from("tenants").select("id, name").in("id", tenantIds) : { data: [] };
    const nameByTenant = new Map((tenants ?? []).map((t) => [t.id, t.name]));

    return (wishes ?? []).map((w) => ({
      id: w.id,
      tenantId: w.tenant_id,
      tenantName: nameByTenant.get(w.tenant_id) ?? "Unknown tenant",
      year: w.year,
      mode: w.mode as AnniversaryWishMode,
      status: w.status as AnniversaryWishView["status"],
      scheduledFor: w.scheduled_for,
      sentAt: w.sent_at,
      message: w.message,
    }));
  }

  /** A platform admin reviewing a 'review'-mode wish -- may edit the message before sending. */
  async sendWish(wishId: string, finalMessage?: string): Promise<void> {
    const update: { status: "sent"; sent_at: string; message?: string } = { status: "sent", sent_at: new Date().toISOString() };
    if (finalMessage) update.message = finalMessage;

    const { error } = await this.supabase.from("anniversary_wishes").update(update).eq("id", wishId).eq("status", "pending");
    if (error) {
      throw new Error(`AnniversaryService.sendWish: ${error.message}`);
    }
  }

  async skipWish(wishId: string): Promise<void> {
    const { error } = await this.supabase.from("anniversary_wishes").update({ status: "skipped" }).eq("id", wishId).eq("status", "pending");
    if (error) {
      throw new Error(`AnniversaryService.skipWish: ${error.message}`);
    }
  }

  /**
   * Tenant 360's "Send anniversary wish" -- on demand, any time, not
   * gated by wish mode or the 7-day pre-anniversary scheduling window
   * ensureScheduledForUpcoming uses (most tenants have no 'pending' row
   * outside that window, which is exactly what sendWish/skipWish above
   * require). Keys off the CURRENT/most-recently-passed occurrence year
   * (not nextOccurrence()'s forward-looking one, which would file a
   * same-day send 11 months out under next year's row if today happens
   * to be just past this year's date) -- e.g. sent on or shortly after
   * the actual anniversary, this lands on this year's row every time.
   * unique(tenant_id, year) (migration 0025) means at most one row per
   * occurrence regardless of path: reuse/overwrite an existing row for
   * that year (already 'pending' -> send it; already 'sent' -> allow a
   * resend/correction with the new message) rather than erroring, since
   * an admin composing an ad-hoc message should be able to fix or repeat
   * one they already sent.
   */
  async sendAdHocWish(tenantId: string, message: string): Promise<void> {
    const { data: tenant } = await this.supabase.from("tenants").select("name, anniversary_date").eq("id", tenantId).maybeSingle();

    if (!tenant?.anniversary_date) {
      throw new Error("This business has no anniversary date on file yet.");
    }

    const occurrenceYear = currentOrMostRecentOccurrenceYear(tenant.anniversary_date, new Date());

    const { data: existing } = await this.supabase
      .from("anniversary_wishes")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("year", occurrenceYear)
      .maybeSingle();

    const now = new Date().toISOString();

    if (existing) {
      const { error } = await this.supabase
        .from("anniversary_wishes")
        .update({ status: "sent", sent_at: now, message })
        .eq("id", existing.id);
      if (error) {
        throw new Error(`AnniversaryService.sendAdHocWish: ${error.message}`);
      }
      return;
    }

    const { error } = await this.supabase.from("anniversary_wishes").insert({
      tenant_id: tenantId,
      year: occurrenceYear,
      mode: "review",
      status: "sent",
      scheduled_for: now.slice(0, 10),
      sent_at: now,
      message,
    });
    if (error) {
      throw new Error(`AnniversaryService.sendAdHocWish: ${error.message}`);
    }
  }

  /**
   * Tenant-facing: a RECENTLY sent wish, for a small banner -- scoped to
   * the last 7 days (not "this year") so it doesn't linger on screen for
   * the rest of the year after being sent once.
   */
  async getActiveWish(tenantId: string): Promise<AnniversaryWishView | null> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: w } = await this.supabase
      .from("anniversary_wishes")
      .select("id, tenant_id, year, mode, status, scheduled_for, sent_at, message")
      .eq("tenant_id", tenantId)
      .eq("status", "sent")
      .gte("sent_at", sevenDaysAgo)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!w) return null;

    return {
      id: w.id,
      tenantId: w.tenant_id,
      tenantName: "",
      year: w.year,
      mode: w.mode as AnniversaryWishMode,
      status: w.status as AnniversaryWishView["status"],
      scheduledFor: w.scheduled_for,
      sentAt: w.sent_at,
      message: w.message,
    };
  }
}

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * The occurrence year for a same-day "send now" -- deliberately backward-
 * looking, unlike nextOccurrence() below (which is for SCHEDULING future
 * wishes). If this year's date has already passed, the most recent real
 * occurrence was last year, not "the one 11 months from now."
 */
function currentOrMostRecentOccurrenceYear(anniversaryDate: string, from: Date): number {
  const anniv = new Date(`${anniversaryDate}T00:00:00Z`);
  const month = anniv.getUTCMonth();
  const day = anniv.getUTCDate();

  const todayStart = startOfDay(from);
  const thisYearOccurrence = new Date(Date.UTC(todayStart.getUTCFullYear(), month, day));

  return thisYearOccurrence.getTime() <= todayStart.getTime()
    ? todayStart.getUTCFullYear()
    : todayStart.getUTCFullYear() - 1;
}

/** Recurs annually on the same month/day -- this year's occurrence if it hasn't passed yet, else next year's. */
function nextOccurrence(anniversaryDate: string, from: Date): { date: Date; yearsCount: number } {
  const anniv = new Date(`${anniversaryDate}T00:00:00Z`);
  const annivYear = anniv.getUTCFullYear();
  const month = anniv.getUTCMonth();
  const day = anniv.getUTCDate();

  const todayStart = startOfDay(from);
  let occurrenceYear = todayStart.getUTCFullYear();
  let candidate = new Date(Date.UTC(occurrenceYear, month, day));
  if (candidate.getTime() < todayStart.getTime()) {
    occurrenceYear += 1;
    candidate = new Date(Date.UTC(occurrenceYear, month, day));
  }

  return { date: candidate, yearsCount: occurrenceYear - annivYear };
}

function defaultWishMessage(tenantName: string, yearsCount: number): string {
  const suffix = ordinalSuffix(yearsCount);
  return `🎉 Happy ${yearsCount}${suffix} Anniversary, ${tenantName}! Thank you for ${yearsCount} great year${yearsCount === 1 ? "" : "s"} with us.`;
}

function ordinalSuffix(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
