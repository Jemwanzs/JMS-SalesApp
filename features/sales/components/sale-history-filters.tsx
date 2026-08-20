"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Sets/clears sale-history's date-range + search filters as URL search
 * params (`from`/`to`/`q`) so the filtered list is server-rendered from
 * SalesService.listRecent's own query, not filtered client-side out of an
 * already-truncated 50/100-row page.
 */
export function SaleHistoryFilters({ todayDate }: { todayDate: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [q, setQ] = useState(searchParams.get("q") ?? "");

  const hasFilters = Boolean(
    searchParams.get("from") || searchParams.get("to") || searchParams.get("q"),
  );
  const isToday = searchParams.get("from") === todayDate && searchParams.get("to") === todayDate;

  function apply(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q.trim()) params.set("q", q.trim());

    startTransition(() => {
      router.push(params.size ? `${pathname}?${params.toString()}` : pathname);
    });
  }

  function goToday() {
    setFrom(todayDate);
    setTo(todayDate);
    setQ("");
    startTransition(() => {
      router.push(`${pathname}?from=${todayDate}&to=${todayDate}`);
    });
  }

  function clear() {
    setFrom("");
    setTo("");
    setQ("");
    startTransition(() => {
      router.push(pathname);
    });
  }

  return (
    <form
      onSubmit={apply}
      className="mb-4 flex flex-col gap-3 rounded-lg border p-3"
    >
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={isToday ? "default" : "outline"}
          disabled={isPending}
          onClick={goToday}
        >
          Today
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="sh-from" className="text-xs">
            From
          </Label>
          <Input
            id="sh-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sh-to" className="text-xs">
            To
          </Label>
          <Input
            id="sh-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="sh-q" className="text-xs">
          Search (sale number or product)
        </Label>
        <Input
          id="sh-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="SALE-2026-000012 or product name"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Applying..." : "Apply"}
        </Button>
        {hasFilters && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clear}
            disabled={isPending}
          >
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}
