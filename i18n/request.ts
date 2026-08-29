import { getRequestConfig } from "next-intl/server";

import { resolvePreferredLocale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

/**
 * My Preferences (Language): this app deliberately runs next-intl in
 * no-URL-prefix mode (no `[locale]` route segment -- see
 * docs/22-hardening-roadmap.md's "6.2 advisory" for why a URL-prefix
 * rollout would be enormously disruptive here), so `requestLocale`
 * (which corresponds to a `[locale]` segment matched by middleware) is
 * deliberately unused -- next-intl's own docs document this as a
 * supported case ("the value can be undefined when a page outside of
 * the [locale] segment renders"). The locale is resolved from
 * profiles.default_locale instead, the single source of truth already
 * established for every other per-user preference (font, theme) in
 * this app -- no separate cookie to keep in sync with it.
 *
 * Falls back to "en" for a signed-out request (login/signup/marketing
 * pages -- there's no profile to read yet) and for any signed-in user
 * who hasn't set a preference.
 */
export default getRequestConfig(async () => {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const locale = user ? await resolvePreferredLocale(supabase, user.id) : "en";

  const messages = (await import(`../messages/${locale}.json`)).default;

  return { locale, messages };
});
