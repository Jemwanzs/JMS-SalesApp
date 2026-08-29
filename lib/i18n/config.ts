import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * My Preferences (Language): mirrors lib/branding/preferred-font.ts's
 * exact shape, but the storage column is profiles.default_locale --
 * already existed since migration 0001 (`not null default 'en'`), never
 * read by any application code until now. Reused directly rather than
 * adding a new column, the same "repurpose a dormant column" pattern
 * migration 0043 already used for tenants.logo_url.
 *
 * Swahili gets "sw-KE" for BCP-47-facing formatting (this app's actual
 * market, per docs/22-hardening-roadmap.md's i18n advisory), Arabic
 * "ar-SA" as a reasonable default region. RTL is scoped to exactly the
 * languages that need it -- Arabic only, of the four supported here.
 */
export const SUPPORTED_LOCALES = ["en", "fr", "sw", "ar"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  fr: "Français",
  sw: "Kiswahili",
  ar: "العربية",
};

export const LOCALE_BCP47: Record<SupportedLocale, string> = {
  en: "en-US",
  fr: "fr-FR",
  sw: "sw-KE",
  ar: "ar-SA",
};

export const RTL_LOCALES = new Set<SupportedLocale>(["ar"]);

/**
 * Falls back to "en" both when unset and when a stored value doesn't
 * match the current supported list -- same defensive shape as
 * resolvePreferredFont/resolveColorPalette. Signed-out requests (no
 * userId to resolve) also fall back to "en" at the call site, not here.
 */
export async function resolvePreferredLocale(supabase: SupabaseClient<Database>, userId: string): Promise<SupportedLocale> {
  const { data } = await supabase.from("profiles").select("default_locale").eq("id", userId).maybeSingle();

  const stored = data?.default_locale;
  return (SUPPORTED_LOCALES as readonly string[]).includes(stored ?? "") ? (stored as SupportedLocale) : "en";
}
