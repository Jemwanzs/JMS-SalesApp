"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DatePreset } from "@/lib/utils/date-ranges";

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" },
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
            {p.label}
          </Button>
        ))}
      </div>

      {canPastDates && (
        <form onSubmit={applyCustom} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="an-from" className="text-xs">
              {canDateRange ? "From" : "Custom date"}
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
                To
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
            Apply
          </Button>
        </form>
      )}
    </div>
  );
}
