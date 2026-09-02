import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { ExpenseAnalyticsFilters } from "@/features/expenses/components/expense-analytics-filters";
import { ExpenseBreakdownList } from "@/features/expenses/components/expense-breakdown-list";
import { ExpenseSummaryCards } from "@/features/expenses/components/expense-summary-cards";
import { ExpenseService } from "@/services/ExpenseService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { resolvePreset, todayString } from "@/lib/utils/date-ranges";

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
  searchParams: Promise<{ date?: string }>;
}) {
  const { tenantSlug } = await params;
  const { date } = await searchParams;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canViewAnalytics, expensesEnabled] = await Promise.all([
    can("expenses.view_analytics", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "expenses_enabled"),
  ]);
  if (!canViewAnalytics || !expensesEnabled) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const today = todayString(tenant.timezone);
  const yesterday = resolvePreset("yesterday", tenant.timezone).from;
  const activeDate = date && date <= today ? date : today;

  const summary = await new ExpenseService(supabase).getSummary(tenant.id, activeDate);

  const highestSentence =
    summary.highestItem && summary.highestItemShare != null
      ? `${summary.highestItem.expenseItemName} is ${activeDate === today ? "today's" : "the selected date's"} highest expense, accounting for ${Math.round(summary.highestItemShare * 100)}% of total expenses.`
      : null;

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/expenses`} label="Expenses" />
      <h1 className="mb-4 text-xl font-semibold">Expense Summary</h1>

      <ExpenseAnalyticsFilters todayDate={today} yesterdayDate={yesterday} activeDate={activeDate} />

      <div className="flex flex-col gap-4">
        <ExpenseSummaryCards summary={summary} />

        {highestSentence && <p className="rounded-lg border bg-muted/30 p-3 text-sm">{highestSentence}</p>}

        {summary.byItem.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No expenses recorded for {activeDate}.</p>
        ) : (
          <ExpenseBreakdownList items={summary.byItem} />
        )}
      </div>
    </div>
  );
}
