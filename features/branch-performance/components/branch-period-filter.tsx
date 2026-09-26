"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DatePreset } from "@/lib/utils/date-ranges";

interface BranchOption {
  id: string;
  name: string;
}

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This Week" },
  { value: "last_month", label: "Last Month" },
  { value: "this_month", label: "This Month" },
];

/**
 * The shared Branch + Period filter for every tab of Branch Performance.
 * window.location.assign, not router.push -- this codebase's own
 * standing bug for search-param-only, same-pathname navigations (see
 * OrderFilters/ExpenseFilters' identical header comments). Always
 * preserves `?tab=` so switching branch/period never resets the active
 * tab, and switching tabs (a client-side Base UI Tabs interaction, no
 * navigation) never loses the branch/period selection.
 *
 * The branch control only renders when `branches` is non-empty --
 * resolveBranchScope() (features/branch-performance/lib/resolve-branch-
 * scope.ts) already returns an EMPTY array for a confined caller, so
 * this component has nothing to show them beyond their own branch and
 * simply omits the control entirely (hidden, not shown-disabled) --
 * belt-and-suspenders alongside that resolver's own server-side clamp,
 * which is the real enforcement.
 */
export function BranchPeriodFilter({
  branches,
  selectedLocationId,
  selectedPreset,
  from,
  to,
  activeTab,
}: {
  branches: BranchOption[];
  selectedLocationId: string | null;
  selectedPreset: DatePreset | null;
  from?: string;
  to?: string;
  activeTab: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState(from ?? "");
  const [customTo, setCustomTo] = useState(to ?? "");
  const [isPending, setIsPending] = useState(false);

  function navigate(overrides: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    params.set("tab", activeTab);
    setIsPending(true);
    window.location.assign(`${pathname}?${params.toString()}`);
  }

  function goBranch(locationId: string) {
    navigate({ branch: locationId || null });
  }

  function goPreset(preset: DatePreset) {
    navigate({ preset, from: null, to: null });
  }

  function applyCustomRange(e: React.FormEvent) {
    e.preventDefault();
    if (!customFrom) return;
    navigate({ preset: null, from: customFrom, to: customTo || customFrom });
  }

  const isCustom = !selectedPreset;

  return (
    <div className="mb-4 flex flex-col gap-3">
      {branches.length > 0 && (
        <div className="w-full">
          <Select
            items={[{ value: "", label: "All Branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
            value={selectedLocationId ?? ""}
            onValueChange={(value) => goBranch(value ?? "")}
          >
            <SelectTrigger id="branch-performance-branch" className="w-full" disabled={isPending}>
              <SelectValue placeholder="All Branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.value}
            type="button"
            size="sm"
            variant={selectedPreset === p.value ? "default" : "outline"}
            disabled={isPending}
            onClick={() => goPreset(p.value)}
          >
            {p.label}
          </Button>
        ))}
        <Button type="button" size="sm" variant={isCustom ? "default" : "outline"} disabled={isPending} onClick={() => setCustomFrom(customFrom || from || "")}>
          Custom Range
        </Button>
      </div>

      {(isCustom || customFrom) && (
        <form onSubmit={applyCustomRange} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="bp-from" className="text-xs">
              From
            </Label>
            <Input id="bp-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bp-to" className="text-xs">
              To
            </Label>
            <Input id="bp-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={isPending || !customFrom}>
            Apply
          </Button>
        </form>
      )}
    </div>
  );
}
