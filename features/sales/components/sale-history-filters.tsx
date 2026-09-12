"use client";

import { useState } from "react";
import { useSearchParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { DailyReportDialog } from "@/features/sales/components/daily-report-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Sets/clears sale-history's date + product filters as URL search
 * params (`from`/`to`/`productId`) so the filtered list is server-
 * rendered from SalesService.listRecent's own query, not filtered
 * client-side out of an already-truncated 50/100-row page. Also hosts
 * the Daily Report trigger (Product Enhancements #7) -- "near the
 * date/filter area" per spec.
 *
 * Single date, not a range -- a two-field From/To picker is exactly
 * what caused a real live bug: a tenant typing digits into both native
 * date inputs by hand landed on the wrong date (native <input
 * type="date"> displays in the browser's own locale format, not
 * necessarily the tenant's day-to-day DD/MM convention) and saw "no
 * sales match" for a day that genuinely had data. Today/Yesterday/
 * Select Date (matching the Stock Overview's own date filter) sets
 * `from` and `to` to the SAME value under the hood -- SalesService.
 * listRecent and the CSV export both stay range-capable, this UI just
 * never asks the tenant to coordinate two fields for an ordinary single
 * day. "Filter by product" (an exact FK match against the live
 * catalog) replaces the old free-text sale-number/product search --
 * picking a real product from a list can't typo/miss a partial match,
 * and stays correct even if a product is renamed after the sale.
 */
export function SaleHistoryFilters({
  tenantId,
  todayDate,
  yesterdayDate,
  products,
  correctedOnly,
}: {
  tenantId: string;
  todayDate: string;
  yesterdayDate: string;
  products: { id: string; name: string }[];
  correctedOnly: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, setIsPending] = useState(false);
  const t = useTranslations("SalesHistory");

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const productId = searchParams.get("productId") ?? "";
  const [customDate, setCustomDate] = useState(
    from && from === to && from !== todayDate && from !== yesterdayDate ? from : ""
  );

  const hasDateFilter = Boolean(from || to);
  // Corrected Records has no "today" default (a corrected original keeps
  // its own, possibly much older, sale_date), so an empty date filter
  // there means "show all of them", not "today" -- the Today button
  // shouldn't read as active in that state.
  const isToday = correctedOnly ? hasDateFilter && from === todayDate && to === todayDate : !hasDateFilter || (from === todayDate && to === todayDate);
  const isYesterday = from === yesterdayDate && to === yesterdayDate;
  const hasFilters = hasDateFilter || Boolean(productId);

  function apply(nextDate: string | null, nextProductId: string) {
    const params = new URLSearchParams();
    if (nextDate) {
      params.set("from", nextDate);
      params.set("to", nextDate);
    }
    if (nextProductId) params.set("productId", nextProductId);
    // Changing the date/product filter must not silently drop out of the
    // Corrected Records sub-view -- only the explicit Back/Clear actions
    // should do that.
    if (correctedOnly) params.set("view", "corrected");

    navigate(params.size ? `${pathname}?${params.toString()}` : pathname);
  }

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
  // transition -- worth it for a low-frequency action like a date/product
  // filter.
  function navigate(target: string) {
    setIsPending(true);
    window.location.assign(target);
  }

  function goToday() {
    setCustomDate("");
    apply(null, productId);
  }

  function goYesterday() {
    setCustomDate("");
    apply(yesterdayDate, productId);
  }

  function onCustomDateChange(value: string) {
    setCustomDate(value);
    if (value) apply(value, productId);
  }

  function onProductChange(value: string) {
    apply(isToday ? null : (from ?? null), value);
  }

  function clear() {
    setCustomDate("");
    navigate(pathname);
  }

  // Corrected Records is a separate sub-view of this same page (`?view=
  // corrected`), not a new route -- per the request to view them "right
  // inside this History". It has no meaningful date filter (a corrected
  // original keeps its OWN sale_date, which could be any day), so
  // switching into it only carries the product filter forward, not from/to.
  function viewCorrectedRecords() {
    const params = new URLSearchParams();
    params.set("view", "corrected");
    if (productId) params.set("productId", productId);
    navigate(`${pathname}?${params.toString()}`);
  }

  function backToSalesHistory() {
    navigate(pathname);
  }

  return (
    <div className="mb-4 flex flex-col items-center gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="sm" variant={isToday ? "default" : "outline"} disabled={isPending} onClick={goToday}>
          {t("today")}
        </Button>
        <Button type="button" size="sm" variant={isYesterday ? "default" : "outline"} disabled={isPending} onClick={goYesterday}>
          {t("yesterday")}
        </Button>
        <DailyReportDialog tenantId={tenantId} todayDate={todayDate} />
      </div>
      {!correctedOnly && !hasDateFilter && <span className="text-xs text-muted-foreground">{t("showingTodayDefault")}</span>}

      <div className="flex w-full flex-col items-center gap-3">
        <div className="w-full max-w-xs space-y-1 text-center">
          <Label htmlFor="sh-date" className="text-xs">
            {t("selectDate")}
          </Label>
          <Input id="sh-date" type="date" value={customDate} max={todayDate} onChange={(e) => onCustomDateChange(e.target.value)} />
        </div>

        <div className="w-full max-w-xs space-y-1 text-center">
          <Label htmlFor="sh-product" className="text-xs">
            {t("filterByProduct")}
          </Label>
          <select
            id="sh-product"
            value={productId}
            onChange={(e) => onProductChange(e.target.value)}
            className="border-input flex h-9 w-full items-center justify-between rounded-lg border bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
          >
            <option value="">{t("allProducts")}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {correctedOnly ? (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={backToSalesHistory}>
            {t("backToSalesHistory")}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={viewCorrectedRecords}>
            {t("correctedRecords")}
          </Button>
        )}
      </div>

      {hasFilters && (
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={isPending}>
          {t("clear")}
        </Button>
      )}
    </div>
  );
}
