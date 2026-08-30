import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * My Preferences (Theme & Colors): a curated set of accent-color presets,
 * mirroring lib/branding/preferred-font.ts's exact shape. Deliberately
 * scoped to accent/interactive tokens only (--primary, --ring,
 * --sidebar-primary/-ring, --chart-1) -- never --background/--card/
 * --muted/--border -- so contrast and readability stay guaranteed no
 * matter which preset is picked (the whole reason "curated" was chosen
 * over a free-form color picker).
 *
 * "green" is first in this list AND the resolve fallback below -- it's
 * the platform default now, not "default" (which stays as a real,
 * separately-selectable option: today's original near-black look, kept
 * for continuity, distinct from "forest"'s deeper green so renaming
 * neither key ever silently reassigns an existing user's own choice).
 */
export const KNOWN_PALETTES = ["green", "default", "ocean", "forest", "sunset", "slate"] as const;
export type KnownPalette = (typeof KNOWN_PALETTES)[number];

export const PALETTE_LABELS: Record<KnownPalette, string> = {
  green: "Green",
  default: "Default",
  ocean: "Ocean",
  forest: "Forest",
  sunset: "Sunset",
  slate: "Slate",
};

/** A representative swatch color per preset, for rendering the picker's color chips -- matches each preset's --primary value in app/globals.css. */
export const PALETTE_SWATCH_COLOR: Record<KnownPalette, string> = {
  green: "#16a34a",
  default: "#171717",
  ocean: "#0e7490",
  forest: "#15803d",
  sunset: "#c2410c",
  slate: "#475569",
};

/**
 * Falls back to "green" both when nothing is set (a user who's never
 * touched the preference -- including every brand-new user) and when a
 * stored value doesn't match the current known list (defensive -- same
 * reasoning as resolvePreferredFont: a future preset removal should
 * never leave an old value pointing at a CSS rule that no longer
 * exists). An existing user's own explicit, non-null stored value
 * (including the literal "default") is untouched by this and keeps
 * resolving to exactly what they picked.
 */
export async function resolveColorPalette(supabase: SupabaseClient<Database>, userId: string): Promise<KnownPalette> {
  const { data } = await supabase.from("profiles").select("color_palette").eq("id", userId).maybeSingle();

  const stored = data?.color_palette;
  return (KNOWN_PALETTES as readonly string[]).includes(stored ?? "") ? (stored as KnownPalette) : "green";
}
