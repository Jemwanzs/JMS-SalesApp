"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * A single viewed date (default today) + a text search over expense
 * item names, as URL search params (`date`/`q`) -- same server-rendered-
 * filter idiom SaleHistoryFilters uses, scaled down to one date instead
 * of a range since Expenses has no date-range browsing (only Today/
 * Yesterday/a specific date, all single-day).
 *
 * Two distinct dates, on purpose (Business Day Rollover): `effectiveToday`
 * is what the "Today" button jumps to and what counts as "today" for the
 * highlight -- the effective BUSINESS date, matching the page's own
 * default view (see app/.../expenses/page.tsx). `maxDate` is the real
 * calendar date, only ever used to cap how far forward the manual date
 * picker can browse -- deliberately not business-day-aware, since
 * browsing "today by the clock" is always a legitimate thing to look at
 * even when it isn't the default.
 */
export function ExpenseFilters({ effectiveToday, maxDate }: { effectiveToday: string; maxDate: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [date, setDate] = useState(searchParams.get("date") ?? effectiveToday);
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  const isToday = date === effectiveToday;

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (date && date !== effectiveToday) params.set("date", date);
    if (q.trim()) params.set("q", q.trim());

    startTransition(() => {
      router.push(params.size ? `${pathname}?${params.toString()}` : pathname);
    });
  }

  function goToday() {
    setDate(effectiveToday);
    startTransition(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      router.push(params.size ? `${pathname}?${params.toString()}` : pathname);
    });
  }

  return (
    <form onSubmit={apply} className="mb-4 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={isToday ? "default" : "outline"} disabled={isPending} onClick={goToday}>
          Today
        </Button>
        {!isToday && <span className="text-xs text-muted-foreground">Viewing {date}</span>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="exp-date" className="text-xs">
          Date
        </Label>
        <Input id="exp-date" type="date" max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="exp-q" className="text-xs">
          Search
        </Label>
        <Input id="exp-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by expense name" />
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Applying..." : "Apply"}
      </Button>
    </form>
  );
}
