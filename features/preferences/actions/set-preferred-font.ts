"use server";

import { revalidatePath } from "next/cache";

import { KNOWN_FONTS, type KnownFont } from "@/lib/branding/preferred-font";
import { createClient } from "@/lib/supabase/server";

export interface SetPreferredFontState {
  error?: string;
}

/**
 * User & Tenant Branding Personalization (moved into My Preferences,
 * see features/preferences): purely personal, no settings.manage/
 * permission gate at all -- any signed-in user may set their OWN font
 * preference. profiles_update_own RLS (migration 0001) already only
 * ever lets a caller write their own row regardless of what tenantId/
 * profileId a client might try to send, so there's no cross-user or
 * cross-tenant write surface here to defend against beyond that.
 */
export async function setPreferredFontAction(tenantSlug: string, font: KnownFont): Promise<SetPreferredFontState> {
  if (!(KNOWN_FONTS as readonly string[]).includes(font)) {
    return { error: "Not a valid font choice" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase.from("profiles").update({ preferred_font: font }).eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  // Revalidates every route under this tenant, not just /security --
  // the font applies to the whole app-shell wrapper in
  // app/(tenant)/t/[tenantSlug]/layout.tsx, so a stale cached render of
  // any other page would otherwise keep showing the old font until its
  // own next natural revalidation.
  revalidatePath(`/t/${tenantSlug}`, "layout");

  return {};
}
