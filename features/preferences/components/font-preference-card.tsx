"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setPreferredFontAction } from "@/features/preferences/actions/set-preferred-font";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FONT_LABELS, KNOWN_FONTS, type KnownFont } from "@/lib/branding/preferred-font";
import { cn } from "@/lib/utils";

const FONT_VAR: Record<KnownFont, string> = {
  outfit: "var(--font-outfit)",
  inter: "var(--font-inter)",
  roboto: "var(--font-roboto)",
  poppins: "var(--font-poppins)",
  lato: "var(--font-lato)",
};

/**
 * User & Tenant Branding Personalization (moved into My Preferences,
 * see features/preferences): purely personal, no permission gate --
 * every signed-in user manages their own account here.
 *
 * Each option is rendered IN its own actual font (inline style against
 * the same CSS variables app/globals.css's [data-font="..."] rules
 * apply) so a user can see what they're choosing, not just read its
 * name. Selecting one applies it to #app-shell immediately, client-
 * side, before the server action confirms -- the same optimistic-then-
 * reconcile shape every other toggle on this page already uses, just
 * applied to a DOM attribute instead of component state, since the
 * thing being changed here is a page-wide rendering token, not
 * something this component itself displays.
 */
export function FontPreferenceCard({ tenantSlug, initialFont }: { tenantSlug: string; initialFont: KnownFont }) {
  const [selected, setSelected] = useState<KnownFont>(initialFont);
  const [isPending, startTransition] = useTransition();

  function choose(font: KnownFont) {
    if (font === selected) return;

    const previous = selected;
    setSelected(font);
    document.getElementById("app-shell")?.setAttribute("data-font", font);

    startTransition(async () => {
      const result = await setPreferredFontAction(tenantSlug, font);
      if (result.error) {
        setSelected(previous);
        document.getElementById("app-shell")?.setAttribute("data-font", previous);
        toast.error(result.error);
        return;
      }
      toast.success("Font updated");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Choose the font you see across the app. This only affects your own account — no one else on your team is
          affected.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KNOWN_FONTS.map((font) => (
            <button
              key={font}
              type="button"
              disabled={isPending}
              onClick={() => choose(font)}
              style={{ fontFamily: FONT_VAR[font] }}
              className={cn(
                "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                selected === font ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted"
              )}
            >
              {FONT_LABELS[font]}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
