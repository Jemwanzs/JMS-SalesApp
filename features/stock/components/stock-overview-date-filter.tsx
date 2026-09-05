"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Overview's "Today | Yesterday | Select Date" filter -- a single date,
 * never a range, per spec. Drives the whole page via a `?overviewDate=`
 * search param (same URL-search-param-driven-refetch idiom
 * sale-history-filters.tsx already established), so switching tabs
 * never loses the selection and a shared link reproduces the exact same
 * view. Only the Overview tab's own data depends on this param -- the
 * other five tabs are unaffected.
 */
export function StockOverviewDateFilter({
  todayDate,
  yesterdayDate,
  selectedDate,
}: {
  todayDate: string;
  yesterdayDate: string;
  selectedDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [customDate, setCustomDate] = useState(
    selectedDate !== todayDate && selectedDate !== yesterdayDate ? selectedDate : ""
  );

  function go(date: string) {
    startTransition(() => {
      router.push(date === todayDate ? pathname : `${pathname}?overviewDate=${date}`);
    });
  }

  function onCustomChange(value: string) {
    setCustomDate(value);
    if (value) go(value);
  }

  const isToday = selectedDate === todayDate;
  const isYesterday = selectedDate === yesterdayDate;
  const isCustom = !isToday && !isYesterday;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant={isToday ? "default" : "outline"} disabled={isPending} onClick={() => go(todayDate)}>
        Today
      </Button>
      <Button type="button" size="sm" variant={isYesterday ? "default" : "outline"} disabled={isPending} onClick={() => go(yesterdayDate)}>
        Yesterday
      </Button>
      <Input
        type="date"
        value={customDate}
        onChange={(e) => onCustomChange(e.target.value)}
        max={todayDate}
        className={`h-8 w-auto ${isCustom ? "border-primary" : ""}`}
        aria-label="Select date"
      />
    </div>
  );
}
