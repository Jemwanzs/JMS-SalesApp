"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DatePreset } from "@/lib/utils/date-ranges";

/** Keys into the "Analytics" namespace -- not the display label itself, see PRESETS' own usage below. */
const PRESETS: { key: DatePreset; labelKey: "presetToday" | "presetYesterday" | "presetThisWeek" | "presetLastWeek" | "presetThisMonth" | "presetLastMonth" }[] = [
  { key: "today", labelKey: "presetToday" },
  { key: "yesterday", labelKey: "presetYesterday" },
  { key: "this_week", labelKey: "presetThisWeek" },
  { key: "last_week", labelKey: "presetLastWeek" },
  { key: "this_month", labelKey: "presetThisMonth" },
  { key: "last_month", labelKey: "presetLastMonth" },
];

/**
 * Preset buttons + custom date/range inputs, permission-gated per
 * docs/11-analytics-reports.md: every preset but "Today" needs
 * analytics.past_dates; a genuine multi-day custom range additionally
 * needs analytics.date_range. Buttons/inputs the caller can't use are
 * hidden outright, not shown-disabled (same convention as the More
 * menu's Approvals row).
 */
export function AnalyticsFilters({
  canPastDates,
  canDateRange,
}: {
  canPastDates: boolean;
  canDateRange: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations("Analytics");

  const activePreset = searchParams.get("preset") ?? (searchParams.get("from") ? null : "today");
  const [customFrom, setCustomFrom] = useState(searchParams.get("from") ?? "");
  const [customTo, setCustomTo] = useState(searchParams.get("to") ?? "");

  function goToPreset(preset: DatePreset) {
    startTransition(() => {
      router.push(`${pathname}?preset=${preset}`);
    });
  }

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customFrom) return;
    const params = new URLSearchParams();
    params.set("from", customFrom);
    params.set("to", customTo || customFrom);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.filter((p) => p.key === "today" || canPastDates).map((p) => (
          <Button
            key={p.key}
            type="button"
            size="sm"
            variant={activePreset === p.key ? "default" : "outline"}
            disabled={isPending}
            onClick={() => goToPreset(p.key)}
          >
            {t(p.labelKey)}
          </Button>
        ))}
      </div>

      {canPastDates && (
        <form onSubmit={applyCustom} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="an-from" className="text-xs">
              {canDateRange ? t("from") : t("customDate")}
            </Label>
            <Input
              id="an-from"
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </div>
          {canDateRange && (
            <div className="space-y-1">
              <Label htmlFor="an-to" className="text-xs">
                {t("to")}
              </Label>
              <Input
                id="an-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}
          <Button type="submit" size="sm" variant="outline" disabled={isPending || !customFrom}>
            {t("apply")}
          </Button>
        </form>
      )}
    </div>
  );
}
