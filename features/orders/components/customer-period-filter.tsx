"use client";

import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";

const PERIODS: { value: "this_month" | "this_year" | ""; label: string }[] = [
  { value: "", label: "All Time" },
  { value: "this_month", label: "This Month" },
  { value: "this_year", label: "This Year" },
];

/**
 * window.location.assign, not router.push -- this codebase's own
 * standing bug for search-param-only, same-pathname navigations (see
 * OrderFilters' identical header comment). Default is All Time (spec
 * section 9), i.e. no `period` param at all.
 */
export function CustomerPeriodFilter() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentPeriod = searchParams.get("period") ?? "";
  const currentQ = searchParams.get("q") ?? "";

  function goTo(period: string) {
    const params = new URLSearchParams();
    if (currentQ) params.set("q", currentQ);
    if (period) params.set("period", period);
    window.location.assign(params.size ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {PERIODS.map((p) => (
        <Button key={p.value || "all"} type="button" size="sm" variant={currentPeriod === p.value ? "default" : "outline"} onClick={() => goTo(p.value)}>
          {p.label}
        </Button>
      ))}
    </div>
  );
}
