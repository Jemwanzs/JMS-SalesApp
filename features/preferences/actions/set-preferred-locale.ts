"use server";

import { revalidatePath } from "next/cache";

import { SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";

export interface SetPreferredLocaleState {
  error?: string;
}

/**
 * My Preferences (Language): purely personal, no settings.manage/
 * permission gate at all -- mirrors set-preferred-font.ts exactly, down
 * to relying on the same profiles_update_own RLS policy (migration
 * 0001). Writes profiles.default_locale, which i18n/request.ts reads
 * fresh on the very next request -- no client-side data-attribute swap
 * needed here the way font/theme have (a resolved locale determines
 * which server-rendered messages/props are sent down, not a CSS token
 * a client script can flip instantly), so the UI reflects the new
 * language on next navigation/refresh, not before the action resolves.
 */
export async function setPreferredLocaleAction(tenantSlug: string, locale: SupportedLocale): Promise<SetPreferredLocaleState> {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) {
    return { error: "Not a valid language choice" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const { error } = await supabase.from("profiles").update({ default_locale: locale }).eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/t/${tenantSlug}`, "layout");

  return {};
}
