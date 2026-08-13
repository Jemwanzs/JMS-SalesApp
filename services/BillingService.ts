import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * BillingService — subscription state transitions, Paystack webhook
 * processing. The webhook handler is the SOLE authority for state changes
 * — never a frontend "success" screen. Uses the service-role client; no
 * client-authenticated path writes subscriptions/payments directly. See
 * docs/14-billing-paystack.md.
 *
 * Free trial default is 7 days (configurable) — see this file's docs
 * counterpart for the rationale behind overriding the original 1-day
 * spec figure.
 *
 * Not yet implemented — Phase 6.
 */
export class BillingService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async processWebhookEvent(_paystackEventId: string, _payload: unknown) {
    throw new Error(
      "BillingService.processWebhookEvent: not yet implemented (Phase 6c)"
    );
  }
}
