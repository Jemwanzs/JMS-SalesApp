import type { SupabaseClient } from "@supabase/supabase-js";
import webpush, { WebPushError } from "web-push";

import type { Database } from "@/types/database.types";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Web Push (Feature 3) -- wraps `web-push`'s VAPID-signed send call.
 * Service-role only (see lib/supabase/service-role.ts's allowed-callers
 * list): delivering to a tenant's members means reading OTHER profiles'
 * push_subscriptions rows, which RLS deliberately restricts to each
 * subscription's own profile. Only ever constructed inside
 * app/api/cron/outbox/route.ts.
 *
 * VAPID keys are environment configuration, not app data (see
 * .env.example) -- generated once by the repo owner and set both
 * locally and in Vercel, same "manual step outside anything code can
 * do" as applying a migration in Supabase Studio.
 */
export class PushNotificationService {
  constructor(private readonly supabase: SupabaseClient<Database>) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
  }

  /**
   * Sends to every subscription belonging to a profile. A dead
   * subscription (the push service itself returns 404/410 -- the
   * standard "this endpoint no longer exists" signal, e.g. the user
   * uninstalled/cleared site data) is pruned immediately rather than
   * retried, since retrying a permanently-dead endpoint can never
   * succeed. Any other failure (a transient network/service error) is
   * swallowed per-subscription -- one dead or slow device must never
   * block delivery to the rest.
   */
  async sendToProfile(profileId: string, payload: PushPayload): Promise<void> {
    const { data: subscriptions } = await this.supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("profile_id", profileId);

    for (const sub of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        if (err instanceof WebPushError && (err.statusCode === 404 || err.statusCode === 410)) {
          await this.supabase.from("push_subscriptions").delete().eq("id", sub.id);
        }
        // Any other error is a delivery failure for this one
        // subscription only -- not retried, matching how a stale/slow
        // device shouldn't hold up the rest of the fan-out.
      }
    }
  }

  /**
   * First real trigger (migration 0065): a tenant's business day just
   * closed. Reads business_days.aggregates fresh rather than trusting
   * the report_jobs payload's own denormalized copy, and sends only to
   * CURRENTLY active members with a subscription -- re-checked at send
   * time, not "ever subscribed," since a profile's membership can
   * change between when the day closed and when this drains.
   */
  async sendDailySummaryForTenant(tenantId: string, businessDayId: string): Promise<void> {
    const [{ data: businessDay }, { data: tenant }] = await Promise.all([
      this.supabase.from("business_days").select("aggregates").eq("id", businessDayId).maybeSingle(),
      this.supabase.from("tenants").select("name, currency").eq("id", tenantId).maybeSingle(),
    ]);

    if (!businessDay || !tenant) return;

    const aggregates = businessDay.aggregates as { grossSales?: number; transactionCount?: number } | null;
    const grossSales = aggregates?.grossSales ?? 0;
    const transactionCount = aggregates?.transactionCount ?? 0;

    // Two separate queries, not an embedded PostgREST relationship
    // select -- this codebase's hand-written provisional database types
    // don't carry relationship metadata for that syntax (see
    // lib/tenant/resolve-active-tenant.ts's own header comment).
    const { data: members } = await this.supabase
      .from("tenant_memberships")
      .select("profile_id")
      .eq("tenant_id", tenantId)
      .eq("status", "active");
    const activeProfileIds = [...new Set((members ?? []).map((m) => m.profile_id))];

    if (activeProfileIds.length === 0) return;

    const { data: subscribed } = await this.supabase
      .from("push_subscriptions")
      .select("profile_id")
      .in("profile_id", activeProfileIds);
    const profileIds = [...new Set((subscribed ?? []).map((s) => s.profile_id))];

    const payload: PushPayload = {
      title: `${tenant.name}: business day closed`,
      body: `${tenant.currency} ${grossSales.toFixed(2)} across ${transactionCount} sale${transactionCount === 1 ? "" : "s"}.`,
    };

    await Promise.all(profileIds.map((profileId) => this.sendToProfile(profileId, payload)));
  }
}
