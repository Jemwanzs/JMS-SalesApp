import type { Metadata } from "next";

import { BackLink } from "@/components/shared/back-link";
import { FontPreferenceCard } from "@/features/preferences/components/font-preference-card";
import { LanguagePreferenceCard } from "@/features/preferences/components/language-preference-card";
import { ThemePreferenceCard } from "@/features/preferences/components/theme-preference-card";
import { resolveColorPalette } from "@/lib/branding/color-palette";
import { resolvePreferredFont } from "@/lib/branding/preferred-font";
import { resolvePreferredLocale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

export const metadata: Metadata = {
  title: "My Preferences | JMS Sales App",
};

/**
 * My Preferences: the centralized home for personal, per-user-only
 * settings -- Font | Language | Theme & Colors -- none of which affect
 * other users on the same tenant or the tenant's own branding. Always
 * reachable, no permission gate, same "every signed-in user manages
 * their own account here" posture as the Security page's own personal
 * sections. Font previously lived on Security; it moves here as part of
 * this feature (see FontPreferenceCard's own header comment for why it
 * doesn't need a permission gate either).
 */
export default async function PreferencesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();
  const user = await getCurrentUser();

  const [preferredFont, colorPalette, preferredLocale] = await Promise.all([
    resolvePreferredFont(supabase, user!.id),
    resolveColorPalette(supabase, user!.id),
    resolvePreferredLocale(supabase, user!.id),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="text-xl font-semibold">My Preferences</h1>
      <FontPreferenceCard tenantSlug={tenantSlug} initialFont={preferredFont} />
      <LanguagePreferenceCard tenantSlug={tenantSlug} initialLocale={preferredLocale} />
      <ThemePreferenceCard tenantSlug={tenantSlug} initialPalette={colorPalette} />
    </div>
  );
}
