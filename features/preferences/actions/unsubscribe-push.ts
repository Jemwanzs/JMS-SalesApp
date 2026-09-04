"use server";

import { createClient } from "@/lib/supabase/server";

export interface UnsubscribePushState {
  error?: string;
}

export async function unsubscribePushAction(endpoint: string): Promise<UnsubscribePushState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  // .eq("profile_id", user.id) is redundant with push_subscriptions_
  // delete RLS (already scoped to profile_id = auth.uid()) but kept
  // explicit so this can never even attempt to touch another profile's
  // row regardless of RLS.
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("profile_id", user.id);

  if (error) {
    return { error: error.message };
  }

  return {};
}
