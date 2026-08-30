"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setColorPaletteAction } from "@/features/preferences/actions/set-color-palette";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KNOWN_PALETTES, PALETTE_LABELS, PALETTE_SWATCH_COLOR, type KnownPalette } from "@/lib/branding/color-palette";
import { cn } from "@/lib/utils";

/**
 * My Preferences (Theme & Colors): same optimistic-apply-then-reconcile
 * shape FontPreferenceCard already uses, just against a `data-palette`
 * attribute on #app-shell instead of `data-font`. The "Default Color"
 * button is deliberately separate from the swatch grid, not just
 * "click the Default swatch" -- the explicit ask was for a distinct,
 * clearly visible reset affordance.
 */
export function ThemePreferenceCard({ tenantSlug, initialPalette }: { tenantSlug: string; initialPalette: KnownPalette }) {
  const [selected, setSelected] = useState<KnownPalette>(initialPalette);
  const [isPending, startTransition] = useTransition();

  function choose(palette: KnownPalette) {
    if (palette === selected) return;

    const previous = selected;
    setSelected(palette);
    document.getElementById("app-shell")?.setAttribute("data-palette", palette);

    startTransition(async () => {
      const result = await setColorPaletteAction(tenantSlug, palette);
      if (result.error) {
        setSelected(previous);
        document.getElementById("app-shell")?.setAttribute("data-palette", previous);
        toast.error(result.error);
        return;
      }
      toast.success(palette === "green" ? "Theme reset to default" : "Theme updated");
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Theme &amp; Colors</CardTitle>
        <Button type="button" variant="outline" size="sm" disabled={isPending || selected === "green"} onClick={() => choose("green")}>
          Default Color
        </Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">
          Choose an accent color for your own interface. This only affects your own account — your team&apos;s branding
          and other users are unaffected.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KNOWN_PALETTES.map((palette) => (
            <button
              key={palette}
              type="button"
              disabled={isPending}
              onClick={() => choose(palette)}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                selected === palette ? "border-primary bg-primary/5 font-medium" : "border-border hover:bg-muted"
              )}
            >
              <span
                aria-hidden
                className="h-5 w-5 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: PALETTE_SWATCH_COLOR[palette] }}
              />
              {PALETTE_LABELS[palette]}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
