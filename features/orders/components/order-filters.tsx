"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrderStatus } from "@/types/database.types";

const STATUS_TABS: { value: OrderStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "received", label: "Received" },
  { value: "being_attended", label: "Being Attended" },
  { value: "on_delivery", label: "On Delivery" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * window.location.assign, not router.push -- this codebase's own
 * standing bug for search-param-only, same-pathname navigations (see
 * ExpenseFilters' identical header comment). Deliberately lighter than
 * ExpenseFilters: Orders has no branch/category dimension to filter by.
 */
export function OrderFilters({ maxDate }: { maxDate: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, setIsPending] = useState(false);

  const status = (searchParams.get("status") as OrderStatus | null) ?? "";
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [dateFrom, setDateFrom] = useState(searchParams.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") ?? "");

  const hasAnyFilter = Boolean(status || q || dateFrom || dateTo);

  function navigate(params: URLSearchParams) {
    setIsPending(true);
    window.location.assign(params.size ? `${pathname}?${params.toString()}` : pathname);
  }

  function buildParams(overrides: Record<string, string | null>) {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = { status, q, dateFrom, dateTo, ...overrides };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    return params;
  }

  function goStatus(next: OrderStatus | "") {
    navigate(buildParams({ status: next || null }));
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    navigate(buildParams({}));
  }

  function clear() {
    setQ("");
    setDateFrom("");
    setDateTo("");
    setIsPending(true);
    window.location.assign(pathname);
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <Button
            key={tab.value || "all"}
            type="button"
            size="sm"
            variant={status === tab.value ? "default" : "outline"}
            disabled={isPending}
            onClick={() => goStatus(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <form onSubmit={applyFilters} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="order-q" className="text-xs">
            Search
          </Label>
          <Input
            id="order-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Order number or customer name"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="order-date-from" className="text-xs">
              From
            </Label>
            <Input id="order-date-from" type="date" max={maxDate} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="order-date-to" className="text-xs">
              To
            </Label>
            <Input id="order-date-to" type="date" max={maxDate} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Applying..." : "Apply"}
          </Button>
          {hasAnyFilter && (
            <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
