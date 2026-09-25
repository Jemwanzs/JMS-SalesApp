"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OrderStatus } from "@/types/database.types";

interface FilterOption {
  id: string;
  name: string;
}

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
 * ExpenseFilters' identical header comment).
 *
 * Order Processing -- Employee & Branch Attribution: branch/employee
 * are additive filter dimensions on top of the original status/date/
 * search set, satisfying the spec's "available for ... branch/
 * employee performance reporting" requirement without a separate
 * report page -- filtering this same list by processed_from_location_id/
 * processed_by_employee_id already answers "how did branch X / employee
 * Y perform," combined with the existing order totals.
 */
export function OrderFilters({
  maxDate,
  branchOptions,
  employeeOptions,
}: {
  maxDate: string;
  branchOptions: FilterOption[];
  employeeOptions: FilterOption[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, setIsPending] = useState(false);

  const status = (searchParams.get("status") as OrderStatus | null) ?? "";
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [dateFrom, setDateFrom] = useState(searchParams.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(searchParams.get("dateTo") ?? "");
  const [branchId, setBranchId] = useState(searchParams.get("branchId") ?? "");
  const [employeeId, setEmployeeId] = useState(searchParams.get("employeeId") ?? "");

  const hasAnyFilter = Boolean(status || q || dateFrom || dateTo || branchId || employeeId);

  function navigate(params: URLSearchParams) {
    setIsPending(true);
    window.location.assign(params.size ? `${pathname}?${params.toString()}` : pathname);
  }

  function buildParams(overrides: Record<string, string | null>) {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = { status, q, dateFrom, dateTo, branchId, employeeId, ...overrides };
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
    setBranchId("");
    setEmployeeId("");
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

        {(branchOptions.length > 0 || employeeOptions.length > 0) && (
          <div className="grid grid-cols-2 gap-2">
            {branchOptions.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="order-branch" className="text-xs">
                  Branch
                </Label>
                <Select
                  items={[{ value: "", label: "All branches" }, ...branchOptions.map((b) => ({ value: b.id, label: b.name }))]}
                  value={branchId}
                  onValueChange={(value) => setBranchId(value ?? "")}
                >
                  <SelectTrigger id="order-branch" className="w-full">
                    <SelectValue placeholder="All branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All branches</SelectItem>
                    {branchOptions.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {employeeOptions.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="order-employee" className="text-xs">
                  Employee
                </Label>
                <Select
                  items={[{ value: "", label: "All employees" }, ...employeeOptions.map((e) => ({ value: e.id, label: e.name }))]}
                  value={employeeId}
                  onValueChange={(value) => setEmployeeId(value ?? "")}
                >
                  <SelectTrigger id="order-employee" className="w-full">
                    <SelectValue placeholder="All employees" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All employees</SelectItem>
                    {employeeOptions.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

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
