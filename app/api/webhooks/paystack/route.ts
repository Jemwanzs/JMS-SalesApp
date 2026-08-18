import { NextResponse } from "next/server";

import { BillingService } from "@/services/BillingService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * docs/14-billing-paystack.md: "the webhook is the sole source of truth"
 * for subscription/payment state. Reads the RAW request body (not
 * `request.json()`) since signature verification is an HMAC over the
 * exact bytes Paystack sent -- re-serializing a parsed object would
 * produce a different byte sequence and always fail verification. No
 * auth check on this route itself; the signature check IS the auth.
 * Always returns 200 on a processed-or-already-processed outcome so
 * Paystack doesn't retry a webhook we've already handled -- only a
 * genuine failure (bad signature, unexpected error) returns non-2xx,
 * which Paystack will retry.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  try {
    const result = await new BillingService(createServiceRoleClient()).processWebhookEvent(rawBody, signature);
    return NextResponse.json({ received: true, processed: result.processed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Webhook processing failed";
    const status = message.includes("Invalid Paystack webhook signature") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
