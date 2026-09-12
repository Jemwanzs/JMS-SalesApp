"use client";

import { useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolvePreset } from "@/lib/utils/date-ranges";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { ExpenseItem } from "@/services/ExpenseItemService";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";
import type { LocationSummary } from "@/services/LocationService";

/**
 * Date range + presets (Today/Yesterday/This Week/This Month, via the
 * same resolvePreset() the Analytics dashboard already uses) plus
 * category/item/payment-method/vendor/status/receipt/amount filters, all
 * as URL search params -- same server-rendered-filter idiom
 * SaleHistoryFilters uses. Secondary filters sit under "More filters" so
 * the common case (today, maybe a category) stays a glance, not a wall
 * of fields.
 *
 * window.location.assign, not router.push -- this Next.js build's client
 * router can silently fail to commit a same-pathname, different-search-
 * param navigation (see SaleHistoryFilters' own header comment for the
 * full story); this file previously used router.push and inherited that
 * risk, fixed here while expanding the filter set anyway.
 */
export function ExpenseFilters({
  timezone,
  maxDate,
  categories,
  activeItems,
  paymentMethods,
  locations,
  canViewAll,
}: {
  timezone: string;
  maxDate: string;
  categories: ExpenseCategory[];
  activeItems: ExpenseItem[];
  paymentMethods: ExpensePaymentMethod[];
  locations: LocationSummary[];
  canViewAll: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, setIsPending] = useState(false);

  const date = searchParams.get("date") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [categoryId, setCategoryId] = useState(searchParams.get("categoryId") ?? "");
  const [expenseItemId, setExpenseItemId] = useState(searchParams.get("expenseItemId") ?? "");
  const [paymentMethodId, setPaymentMethodId] = useState(searchParams.get("paymentMethodId") ?? "");
  const [vendor, setVendor] = useState(searchParams.get("vendor") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [hasReceipt, setHasReceipt] = useState(searchParams.get("hasReceipt") ?? "");
  const [minAmount, setMinAmount] = useState(searchParams.get("minAmount") ?? "");
  const [maxAmount, setMaxAmount] = useState(searchParams.get("maxAmount") ?? "");
  const [locationId, setLocationId] = useState(searchParams.get("locationId") ?? "");
  const [customDate, setCustomDate] = useState(from && from === to ? from : "");

  const isToday = !date && !from && !to;
  const isYesterday = (() => {
    const y = resolvePreset("yesterday", timezone);
    return date === y.from || (from === y.from && to === y.to);
  })();

  const hasAnyFilter = Boolean(date || from || to || q || categoryId || expenseItemId || paymentMethodId || vendor || status || hasReceipt || minAmount || maxAmount || locationId);

  function navigate(params: URLSearchParams) {
    setIsPending(true);
    window.location.assign(params.size ? `${pathname}?${params.toString()}` : pathname);
  }

  function buildParams(overrides: Record<string, string | null>) {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = {
      date,
      from,
      to,
      q,
      categoryId,
      expenseItemId,
      paymentMethodId,
      vendor,
      status,
      hasReceipt,
      minAmount,
      maxAmount,
      locationId,
      ...overrides,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    return params;
  }

  function goToday() {
    setCustomDate("");
    navigate(buildParams({ date: null, from: null, to: null }));
  }
  function goYesterday() {
    setCustomDate("");
    const y = resolvePreset("yesterday", timezone);
    navigate(buildParams({ date: y.from, from: null, to: null }));
  }
  function goThisWeek() {
    setCustomDate("");
    const r = resolvePreset("this_week", timezone);
    navigate(buildParams({ date: null, from: r.from, to: r.to }));
  }
  function goThisMonth() {
    setCustomDate("");
    const r = resolvePreset("this_month", timezone);
    navigate(buildParams({ date: null, from: r.from, to: r.to }));
  }
  function onCustomDateChange(value: string) {
    setCustomDate(value);
    if (value) navigate(buildParams({ date: value, from: null, to: null }));
  }
  function applyOtherFilters(e: React.FormEvent) {
    e.preventDefault();
    navigate(buildParams({}));
  }
  function clear() {
    setQ("");
    setCategoryId("");
    setExpenseItemId("");
    setPaymentMethodId("");
    setVendor("");
    setStatus("");
    setHasReceipt("");
    setMinAmount("");
    setMaxAmount("");
    setLocationId("");
    setCustomDate("");
    setIsPending(true);
    window.location.assign(pathname);
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="sm" variant={isToday ? "default" : "outline"} disabled={isPending} onClick={goToday}>
          Today
        </Button>
        <Button type="button" size="sm" variant={isYesterday ? "default" : "outline"} disabled={isPending} onClick={goYesterday}>
          Yesterday
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={goThisWeek}>
          This Week
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={goThisMonth}>
          This Month
        </Button>
      </div>

      <div className="space-y-1">
        <Label htmlFor="exp-date" className="text-xs">
          Select date
        </Label>
        <Input id="exp-date" type="date" max={maxDate} value={customDate} onChange={(e) => onCustomDateChange(e.target.value)} />
      </div>

      <form onSubmit={applyOtherFilters} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="exp-q" className="text-xs">
            Search
          </Label>
          <Input id="exp-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by expense name" />
        </div>

        <div className="space-y-1">
          <Label htmlFor="exp-category" className="text-xs">
            Category
          </Label>
          <select
            id="exp-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <Collapsible>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
            More filters
            <ChevronDown className="h-4 w-4 transition-transform group-data-open:rotate-180" />
          </CollapsibleTrigger>
          <CollapsiblePanel className="space-y-3 pt-3">
            <div className="space-y-1">
              <Label htmlFor="exp-item" className="text-xs">
                Expense item
              </Label>
              <select
                id="exp-item"
                value={expenseItemId}
                onChange={(e) => setExpenseItemId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
              >
                <option value="">All items</option>
                {activeItems.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="exp-payment-method" className="text-xs">
                Payment method
              </Label>
              <select
                id="exp-payment-method"
                value={paymentMethodId}
                onChange={(e) => setPaymentMethodId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
              >
                <option value="">All payment methods</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.name}
                  </option>
                ))}
              </select>
            </div>

            {canViewAll && (
              <div className="space-y-1">
                <Label htmlFor="exp-branch" className="text-xs">
                  Branch
                </Label>
                <select
                  id="exp-branch"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
                >
                  <option value="">Every branch</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="exp-vendor" className="text-xs">
                Vendor
              </Label>
              <Input id="exp-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Search by vendor" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="exp-status" className="text-xs">
                Status
              </Label>
              <select
                id="exp-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
              >
                <option value="">Any status</option>
                <option value="active">Active</option>
                <option value="voided">Voided</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="exp-receipt" className="text-xs">
                Receipt
              </Label>
              <select
                id="exp-receipt"
                value={hasReceipt}
                onChange={(e) => setHasReceipt(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
              >
                <option value="">Any</option>
                <option value="true">Has receipt</option>
                <option value="false">Missing receipt</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="exp-min-amount" className="text-xs">
                  Min amount
                </Label>
                <Input id="exp-min-amount" type="number" min="0" step="0.01" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="exp-max-amount" className="text-xs">
                  Max amount
                </Label>
                <Input id="exp-max-amount" type="number" min="0" step="0.01" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
              </div>
            </div>
          </CollapsiblePanel>
        </Collapsible>

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
