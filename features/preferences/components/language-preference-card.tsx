"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setPreferredLocaleAction } from "@/features/preferences/actions/set-preferred-locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * My Preferences (Language): unlike Font/Theme, a locale change can't be
 * reflected with a client-side DOM-attribute swap -- the resolved locale
 * determines which server-rendered messages/props are sent down at all
 * (see i18n/request.ts). router.refresh() re-fetches the current route's
 * server components after the action confirms, so the switch still feels
 * immediate without a full page reload.
 */
export function LanguagePreferenceCard({ tenantSlug, initialLocale }: { tenantSlug: string; initialLocale: SupportedLocale }) {
  const [selected, setSelected] = useState<SupportedLocale>(initialLocale);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function choose(locale: SupportedLocale) {
    if (locale === selected) return;

    const previous = selected;
    setSelected(locale);

    startTransition(async () => {
      const result = await setPreferredLocaleAction(tenantSlug, locale);
      if (result.error) {
        setSelected(previous);
        toast.error(result.error);
        return;
      }
      toast.success("Language updated");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Language</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Choose the language you see across the app. This only affects your own account — no one else on your team is
          affected.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SUPPORTED_LOCALES.map((locale) => (
            <button
              key={locale}
              type="button"
              disabled={isPending}
              onClick={() => choose(locale)}
              className={cn(
                "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                selected === locale ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted"
              )}
            >
              {LOCALE_LABELS[locale]}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
