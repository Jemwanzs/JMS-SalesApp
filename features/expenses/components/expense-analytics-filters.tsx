"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Today / Yesterday / a specific past date only -- no date-range
 * selector, per spec. Reuses the same URL-param-driven navigation idiom
 * every other filter component in this app already uses.
 */
export function ExpenseAnalyticsFilters({
  todayDate,
  yesterdayDate,
  activeDate,
}: {
  todayDate: string;
  yesterdayDate: string;
  activeDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [customDate, setCustomDate] = useState(activeDate);

  function goTo(date: string) {
    startTransition(() => {
      router.push(`${pathname}?date=${date}`);
    });
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={activeDate === todayDate ? "default" : "outline"}
          disabled={isPending}
          onClick={() => goTo(todayDate)}
        >
          Today
        </Button>
        <Button
          type="button"
          size="sm"
          variant={activeDate === yesterdayDate ? "default" : "outline"}
          disabled={isPending}
          onClick={() => goTo(yesterdayDate)}
        >
          Yesterday
        </Button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (customDate) goTo(customDate);
        }}
        className="flex items-end gap-2"
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="analytics-date" className="text-xs">
            Specific date
          </Label>
          <Input id="analytics-date" type="date" max={todayDate} value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
        </div>
        <Button type="submit" size="sm" disabled={isPending}>
          Go
        </Button>
      </form>
    </div>
  );
}
