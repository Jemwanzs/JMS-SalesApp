"use server";

import { revalidatePath } from "next/cache";

import { KNOWN_PALETTES, type KnownPalette } from "@/lib/branding/color-palette";
import { createClient } from "@/lib/supabase/server";

export interface SetColorPaletteState {
  error?: string;
}

/**
 * My Preferences (Theme & Colors): purely personal, no settings.manage/
 * permission gate at all -- mirrors set-preferred-font.ts exactly, down
 * to relying on the same profiles_update_own RLS policy (migration
 * 0001) to keep this a self-only write regardless of what the caller
 * sends.
 */
export async function setColorPaletteAction(tenantSlug: string, palette: KnownPalette): Promise<SetColorPaletteState> {
  if (!(KNOWN_PALETTES as readonly string[]).includes(palette)) {
    return { error: "Not a valid theme choice" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  // "green" is stored as null, same "unset = default" convention
  // resolveColorPalette already treats identically -- no reason to
  // persist the literal string "green" when null already means it.
  const { error } = await supabase
    .from("profiles")
    .update({ color_palette: palette === "green" ? null : palette })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(`/t/${tenantSlug}`, "layout");

  return {};
}
