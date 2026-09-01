"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export interface CompleteTourState {
  error?: string;
}

/**
 * Guided Onboarding Tour: called on Finish AND Skip alike -- both mean
 * "don't auto-show this again," so there's no separate skipped flag to
 * track. No permission gate beyond being signed in, same reasoning as
 * setPreferredFontAction: profiles_update_own RLS (migration 0001)
 * already only ever lets a caller write their own row.
 */
export async function completeTourAction(tenantSlug: string): Promise<CompleteTourState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase.from("profiles").update({ tour_completed_at: new Date().toISOString() }).eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/t/${tenantSlug}`, "layout");

  return {};
}
