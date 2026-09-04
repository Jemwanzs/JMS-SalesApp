"use server";

import { createClient } from "@/lib/supabase/server";

export interface SubscribePushState {
  error?: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}

/**
 * Web Push (Feature 3) -- stores a device's subscription against the
 * caller's own profile. Plain RLS-respecting client: push_subscriptions_
 * insert RLS already scopes this to `profile_id = auth.uid()`, no
 * service-role needed for a self-scoped write. Upserts on `endpoint`
 * (globally unique per the Push API spec) so re-subscribing the same
 * device is idempotent rather than erroring on a duplicate.
 */
export async function subscribePushAction(input: PushSubscriptionInput): Promise<SubscribePushState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      profile_id: user.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_agent: input.userAgent ?? null,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    return { error: error.message };
  }

  return {};
}
