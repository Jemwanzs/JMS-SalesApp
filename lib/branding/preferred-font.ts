import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * User & Tenant Branding Personalization: the fixed, curated font list
 * confirmed with the user -- next/font/google needs the options known
 * at build time (see app/layout.tsx's own header comment), so this is
 * never free text. Shared by the layouts that set `data-font` on their
 * own app-shell wrapper (app/(tenant)/t/[tenantSlug]/layout.tsx, the
 * platform-admin layout), app/globals.css's matching `[data-font="..."]`
 * rules, and the Security page's font picker -- one source of truth for
 * the valid set, not four independent copies of the same five strings.
 */
export const KNOWN_FONTS = ["outfit", "inter", "roboto", "poppins", "lato"] as const;
export type KnownFont = (typeof KNOWN_FONTS)[number];

export const FONT_LABELS: Record<KnownFont, string> = {
  outfit: "Outfit (default)",
  inter: "Inter",
  roboto: "Roboto",
  poppins: "Poppins",
  lato: "Lato",
};

/**
 * Falls back to "outfit" both when nothing is set (a user who's never
 * touched the preference) and when a stored value doesn't match the
 * current known list (defensive -- a future removal of a font option
 * should never leave an old value pointing at a CSS rule that no
 * longer exists).
 */
export async function resolvePreferredFont(supabase: SupabaseClient<Database>, userId: string): Promise<KnownFont> {
  const { data } = await supabase.from("profiles").select("preferred_font").eq("id", userId).maybeSingle();

  const stored = data?.preferred_font;
  return (KNOWN_FONTS as readonly string[]).includes(stored ?? "") ? (stored as KnownFont) : "outfit";
}
