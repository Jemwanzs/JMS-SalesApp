"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolvePreset } from "@/lib/utils/date-ranges";
import type { ExpenseBreakdownDimension } from "@/services/ExpenseService";

const DIMENSIONS: { value: ExpenseBreakdownDimension; label: string }[] = [
  { value: "category", label: "Category" },
  { value: "vendor", label: "Vendor" },
  { value: "paymentMethod", label: "Payment Method" },
  { value: "branch", label: "Branch" },
  { value: "recordedBy", label: "Employee" },
];

/**
 * Today/Yesterday/a specific date (unchanged, drives the existing
 * by-item summary via `date`) PLUS This Week/This Month range presets
 * and a breakdown-dimension selector (drives the newer trend/breakdown/
 * export section via `from`/`to`/`dimension`) -- both live on the same
 * URL so either section can read whichever params it needs.
 *
 * window.location.assign, not router.push -- this Next.js build's client
 * router can silently fail to commit a same-pathname, different-search-
 * param navigation (see SaleHistoryFilters' own header comment).
 */
export function ExpenseAnalyticsFilters({
  effectiveToday,
  maxDate,
  yesterdayDate,
  activeDate,
  timezone,
  dimension,
}: {
  effectiveToday: string;
  maxDate: string;
  yesterdayDate: string;
  activeDate: string;
  timezone: string;
  dimension: ExpenseBreakdownDimension;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, setIsPending] = useState(false);
  const [customDate, setCustomDate] = useState(activeDate);

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  function navigate(params: URLSearchParams) {
    setIsPending(true);
    window.location.assign(`${pathname}?${params.toString()}`);
  }

  function goTo(date: string) {
    navigate(new URLSearchParams({ date, dimension }));
  }

  function goRange(from: string, to: string) {
    navigate(new URLSearchParams({ date: activeDate, from, to, dimension }));
  }

  function onDimensionChange(next: ExpenseBreakdownDimension) {
    const params = new URLSearchParams({ date: activeDate, dimension: next });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    navigate(params);
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={activeDate === effectiveToday ? "default" : "outline"} disabled={isPending} onClick={() => goTo(effectiveToday)}>
          Today
        </Button>
        <Button type="button" size="sm" variant={activeDate === yesterdayDate ? "default" : "outline"} disabled={isPending} onClick={() => goTo(yesterdayDate)}>
          Yesterday
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="analytics-date" className="text-xs">
            Specific date
          </Label>
          <Input id="analytics-date" type="date" max={maxDate} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
        </div>
        <Button type="button" size="sm" disabled={isPending || !customDate} onClick={() => goTo(customDate)}>
          Go
        </Button>
      </div>

      <div className="border-t pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Trend &amp; breakdown range</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              const r = resolvePreset("this_week", timezone);
              goRange(r.from, r.to);
            }}
          >
            This Week
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              const r = resolvePreset("this_month", timezone);
              goRange(r.from, r.to);
            }}
          >
            This Month
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          <Label htmlFor="analytics-dimension" className="text-xs">
            Breakdown by
          </Label>
          <select
            id="analytics-dimension"
            value={dimension}
            onChange={(e) => onDimensionChange(e.target.value as ExpenseBreakdownDimension)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
          >
            {DIMENSIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
