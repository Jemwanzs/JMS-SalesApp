"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

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
  const pathname = usePathname();
  const [isPending, setIsPending] = useState(false);
  const [customDate, setCustomDate] = useState(
    selectedDate !== todayDate && selectedDate !== yesterdayDate ? selectedDate : ""
  );

  // A real browser navigation, not router.push()/router.refresh(): this
  // Next.js build's client router can silently fail to commit a
  // same-pathname, different-search-param navigation -- the history API
  // never updates and the page never refetches, even though the network
  // request for the new URL genuinely goes out and succeeds. A manual
  // history.pushState() + deferred router.refresh() can be made to work
  // most of the time, but it's still racing the router's own internal
  // state sync and fails intermittently under real load -- not
  // acceptable for a filter a tenant depends on. window.location.assign
  // has no such race: it's a full reload of the exact URL, guaranteed
  // correct every time, at the cost of a brief flash instead of an SPA
  // transition -- worth it for a low-frequency action like a date filter.
  function go(date: string) {
    setIsPending(true);
    window.location.assign(date === todayDate ? pathname : `${pathname}?overviewDate=${date}`);
  }

  function onCustomChange(value: string) {
    setCustomDate(value);
    if (value) go(value);
  }

  const isToday = selectedDate === todayDate;
  const isYesterday = selectedDate === yesterdayDate;
  const isCustom = !isToday && !isYesterday;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
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
