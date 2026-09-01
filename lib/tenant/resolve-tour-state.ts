import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * Guided Onboarding Tour -- null (never finished or skipped) means the
 * tour should auto-launch the next time this profile reaches the
 * dashboard. Per-profile, not per-tenant: every new team member gets
 * their own first-run tour (see docs/24-multi-branch-access.md-style
 * reasoning, but this one lives with onboarding, not branch access).
 */
export async function resolveTourCompleted(supabase: SupabaseClient<Database>, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("tour_completed_at").eq("id", userId).maybeSingle();
  return data?.tour_completed_at != null;
}
