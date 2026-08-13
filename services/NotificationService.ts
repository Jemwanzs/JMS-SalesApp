import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * NotificationService — in-app notification writes, outbox entries for
 * email delivery, per-user preferences. Nothing writes directly to Resend
 * from inside a database transaction or a pg_cron function — state
 * changes write to the outbox; app/api/cron/outbox drains it
 * independently. See docs/13-notifications.md.
 *
 * Not yet implemented — introduced incrementally alongside the first
 * feature that needs it (Phase 1c: verification email).
 */
export class NotificationService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async notify(_input: {
    tenantId: string | null;
    profileId: string;
    type: string;
    title: string;
    body: string;
  }) {
    throw new Error("NotificationService.notify: not yet implemented (Phase 1c)");
  }
}
