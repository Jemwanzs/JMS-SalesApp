import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { ExpenseAnalyticsFilters } from "@/features/expenses/components/expense-analytics-filters";
import { ExpenseBreakdownList } from "@/features/expenses/components/expense-breakdown-list";
import { ExpenseReportExportBar } from "@/features/expenses/components/expense-report-export-bar";
import { ExpenseSummaryCards } from "@/features/expenses/components/expense-summary-cards";
import { ExpenseTrendChartLazy } from "@/features/expenses/components/expense-trend-chart-lazy";
import { BusinessDayService } from "@/services/BusinessDayService";
import { ExpenseService, type ExpenseBreakdownDimension } from "@/services/ExpenseService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { resolvePreset, todayString } from "@/lib/utils/date-ranges";

const VALID_DIMENSIONS: ExpenseBreakdownDimension[] = ["category", "vendor", "paymentMethod", "branch", "recordedBy"];

export const metadata: Metadata = {
  title: "Expense Summary | JMS Sales App",
};

/**
 * "View Expense Summary / Analytics" -- a dedicated screen, not a modal
 * (spec allows either). Deliberately not the shared Dialog component:
 * this session verified live that it mis-centers on a long scrollable
 * page opened at scroll position 0 (see components/shared/
 * tenant-logo-viewer.tsx's own header comment for the full story) -- a
 * route sidesteps that risk entirely. Today/Yesterday/a specific date
 * only, no range (spec: "Do not add a date-range selector for now").
 * No day-closure gate anywhere -- computed live from `expenses`, same
 * "Reports Must Always Be Available" principle Sales Reports already
 * established.
 */
export default async function ExpenseAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ date?: string; from?: string; to?: string; dimension?: string }>;
}) {
  const { tenantSlug } = await params;
  const { date, from, to, dimension: dimensionParam } = await searchParams;
  const dimension: ExpenseBreakdownDimension = VALID_DIMENSIONS.includes(dimensionParam as ExpenseBreakdownDimension)
    ? (dimensionParam as ExpenseBreakdownDimension)
    : "category";
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canViewAnalytics, canExport, expensesEnabled, requiresDownloadPasscode] = await Promise.all([
    can("expenses.view_analytics", { tenantId: tenant.id }),
    can("expenses.export", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "expenses_enabled"),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "require_download_passcode"),
  ]);
  if (!canViewAnalytics || !expensesEnabled) {
    redirect(`/t/${tenantSlug}/more`);
  }

  // Two distinct "today"s, same split as expenses/page.tsx (Business Day
  // Rollover): `today` is the real calendar date, kept as the future-date
  // clamp boundary (`date <= today`) since a URL-supplied date genuinely
  // ahead of the clock is never valid. `effectiveDate` is the BUSINESS
  // date the default view should target -- during the closing-to-next-
  // opening gap this keeps showing the most recently completed business
  // day instead of a blank "today" that hasn't opened yet.
  const today = todayString(tenant.timezone);
  const yesterday = resolvePreset("yesterday", tenant.timezone).from;
  const activeLocationId = await resolveActiveLocationId(supabase, tenant.id);
  const effectiveDate = activeLocationId
    ? (await new BusinessDayService(supabase).getEffectiveBusinessDate(tenant.id, activeLocationId)).date
    : today;
  const activeDate = date && date <= today ? date : effectiveDate;

  // Trend/breakdown range defaults to "this month" when nothing's been
  // picked yet -- "Reports Must Always Be Available" (this app's own
  // established principle) means landing on this screen for the first
  // time should already show something, not an empty range prompt.
  const monthRange = resolvePreset("this_month", tenant.timezone);
  const rangeFrom = from && from <= today ? from : monthRange.from;
  const rangeTo = to && to <= today ? to : monthRange.to;

  const expenseService = new ExpenseService(supabase);
  const [summary, breakdownEntries, trend] = await Promise.all([
    expenseService.getSummary(tenant.id, activeDate),
    expenseService.getBreakdown(tenant.id, dimension, { from: rangeFrom, to: rangeTo }),
    expenseService.getTrend(tenant.id, { from: rangeFrom, to: rangeTo }),
  ]);

  const highestSentence =
    summary.highestItem && summary.highestItemShare != null
      ? `${summary.highestItem.expenseItemName} is ${activeDate === effectiveDate ? "today's" : "the selected date's"} highest expense, accounting for ${Math.round(summary.highestItemShare * 100)}% of total expenses.`
      : null;

  const dimensionLabel: Record<ExpenseBreakdownDimension, string> = {
    category: "Category",
    vendor: "Vendor",
    paymentMethod: "Payment Method",
    branch: "Branch",
    recordedBy: "Employee",
  };

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/expenses`} label="Expenses" />
      <h1 className="mb-4 text-xl font-semibold">Expense Summary</h1>

      <ExpenseAnalyticsFilters
        effectiveToday={effectiveDate}
        maxDate={today}
        yesterdayDate={yesterday}
        activeDate={activeDate}
        timezone={tenant.timezone}
        dimension={dimension}
      />

      <div className="flex flex-col gap-4">
        <ExpenseSummaryCards summary={summary} />

        {highestSentence && <p className="rounded-lg border bg-muted/30 p-3 text-sm">{highestSentence}</p>}

        {summary.byItem.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No expenses recorded for {activeDate}.</p>
        ) : (
          <ExpenseBreakdownList
            title="Expense Breakdown by Item"
            entries={summary.byItem.map((i) => ({
              key: i.expenseItemId,
              label: i.expenseItemName,
              total: i.total,
              count: i.count,
              estimatedAmount: i.estimatedAmount,
            }))}
          />
        )}

        <div className="border-t pt-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Trend &amp; breakdown for {rangeFrom} to {rangeTo}
          </p>
          <div className="flex flex-col gap-4">
            <ExpenseTrendChartLazy data={trend} />
            {breakdownEntries.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No expenses recorded for this range.</p>
            ) : (
              <ExpenseBreakdownList title={`Expense Breakdown by ${dimensionLabel[dimension]}`} entries={breakdownEntries} />
            )}
            {canExport && (
              <ExpenseReportExportBar
                tenantId={tenant.id}
                filters={{ from: rangeFrom, to: rangeTo }}
                dimension={dimension}
                requiresPasscode={requiresDownloadPasscode === true}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
