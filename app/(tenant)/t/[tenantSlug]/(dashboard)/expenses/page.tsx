import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";
import { BarChart3 } from "lucide-react";

import { ExpenseBudgetStatus } from "@/features/expenses/components/expense-budget-status";
import { ExpenseDashboardCards } from "@/features/expenses/components/expense-dashboard-cards";
import { ExpenseFilters } from "@/features/expenses/components/expense-filters";
import { ExpenseList } from "@/features/expenses/components/expense-list";
import { BusinessDayService } from "@/services/BusinessDayService";
import { ExpenseBudgetService } from "@/services/ExpenseBudgetService";
import { ExpenseCategoryService } from "@/services/ExpenseCategoryService";
import { ExpenseItemService } from "@/services/ExpenseItemService";
import { ExpensePaymentMethodService } from "@/services/ExpensePaymentMethodService";
import { ExpenseService } from "@/services/ExpenseService";
import { LocationService } from "@/services/LocationService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { resolvePreset, todayString } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Expenses | JMS Sales App",
};

/**
 * Daily Expenses Dashboard -- expenses.view-gated, defaults to today with
 * no day-closure gate anywhere (spec: "No day closure should be required
 * before expense reports or analytics can be viewed"). See
 * supabase/migrations/0054_daily_expenses.sql and docs/26-daily-expenses.md.
 */
export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    date?: string;
    from?: string;
    to?: string;
    q?: string;
    categoryId?: string;
    expenseItemId?: string;
    paymentMethodId?: string;
    vendor?: string;
    status?: "active" | "voided" | "pending_approval" | "rejected";
    reimbursementStatus?: "not_applicable" | "pending" | "paid";
    hasReceipt?: string;
    minAmount?: string;
    maxAmount?: string;
    locationId?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const filterParams = await searchParams;
  const { date, from, to, q, categoryId, expenseItemId, paymentMethodId, vendor, status, reimbursementStatus, hasReceipt, minAmount, maxAmount, locationId } =
    filterParams;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canView, expensesEnabled] = await Promise.all([
    can("expenses.view", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "expenses_enabled"),
  ]);
  if (!canView || !expensesEnabled) {
    redirect(`/t/${tenantSlug}/more`);
  }

  // Two distinct "today"s: `today` is the real calendar date (still the
  // right boundary for "no future-dated expenses" -- expenses have no
  // business_day_id at all, by design, so that validation stays
  // calendar-based). `effectiveDate` is the BUSINESS date the default
  // VIEW should show -- for a cross-midnight tenant, during the closing-
  // to-next-opening gap this correctly keeps showing the most recently
  // completed business day instead of going blank. See
  // BusinessDayService's own header comments (migration 0055).
  const today = todayString(tenant.timezone);
  const activeLocationId = await resolveActiveLocationId(supabase, tenant.id);
  const effectiveDate = activeLocationId
    ? (await new BusinessDayService(supabase).getEffectiveBusinessDate(tenant.id, activeLocationId)).date
    : today;

  const hasDateFilter = Boolean(date || from || to);
  const viewedDate = !hasDateFilter ? effectiveDate : date && !from && !to ? date : from === to ? (from ?? "") : `${from ?? "…"} to ${to ?? "…"}`;

  const weekStart = resolvePreset("this_week", tenant.timezone).from;
  const monthStart = resolvePreset("this_month", tenant.timezone).from;

  const expenseService = new ExpenseService(supabase);
  const [
    canCreate,
    canEdit,
    canVoid,
    canViewAnalytics,
    canViewReceipt,
    canDownloadReceipt,
    canViewAll,
    canManageReimbursements,
    expenses,
    activeItems,
    recentlyUsedItemIds,
    categories,
    paymentMethods,
    knownVendors,
    locations,
    dashboardSummary,
    budgetStatus,
  ] = await Promise.all([
    can("expenses.create", { tenantId: tenant.id }),
    can("expenses.edit", { tenantId: tenant.id }),
    can("expenses.void", { tenantId: tenant.id }),
    can("expenses.view_analytics", { tenantId: tenant.id }),
    can("expenses.view_receipt", { tenantId: tenant.id }),
    can("expenses.download_receipt", { tenantId: tenant.id }),
    can("expenses.view_all", { tenantId: tenant.id }),
    can("expenses.manage_reimbursements", { tenantId: tenant.id }),
    expenseService.listExpenses(tenant.id, {
      date: !hasDateFilter ? effectiveDate : date,
      from,
      to,
      q,
      categoryId,
      expenseItemId,
      paymentMethodId,
      vendor,
      status,
      reimbursementStatus,
      hasReceipt: hasReceipt === "true" ? true : hasReceipt === "false" ? false : undefined,
      minAmount: minAmount ? Number(minAmount) : undefined,
      maxAmount: maxAmount ? Number(maxAmount) : undefined,
      locationId,
    }),
    new ExpenseItemService(supabase).listActive(tenant.id),
    new ExpenseItemService(supabase).listRecentlyUsedIds(tenant.id, activeLocationId ?? undefined),
    new ExpenseCategoryService(supabase).listActive(tenant.id),
    new ExpensePaymentMethodService(supabase).listActive(tenant.id),
    expenseService.listDistinctVendors(tenant.id),
    new LocationService(supabase).listLocations(tenant.id),
    // Uses effectiveDate, not the raw calendar `today` -- the list right
    // below these cards already defaults to effectiveDate (business-day-
    // aware), and during the gap after a day closes but before the next
    // one opens, effectiveDate can lag a calendar day behind `today`.
    // Anchoring the KPI cards to a different "today" than the list they
    // sit above would show a "Today" total that disagrees with what's
    // actually displayed once you look below it.
    expenseService.getDashboardSummary(tenant.id, { today: effectiveDate, weekStart, monthStart }),
    activeLocationId
      ? new ExpenseBudgetService(supabase).getBudgetStatus(tenant.id, activeLocationId, monthStart, effectiveDate)
      : Promise.resolve([]),
  ]);

  const defaultPaymentMethodId = paymentMethods.find((pm) => pm.isDefault)?.id ?? paymentMethods[0]?.id ?? "";

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Expenses</h1>
        {canViewAnalytics && (
          <Link
            href={`/t/${tenantSlug}/expenses/analytics?date=${effectiveDate}`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <BarChart3 className="h-4 w-4" />
            Summary
          </Link>
        )}
      </div>

      <ExpenseDashboardCards
        summary={dashboardSummary}
        todayDate={effectiveDate}
        weekStart={weekStart}
        monthStart={monthStart}
        locations={locations}
        canViewAll={canViewAll}
      />

      <ExpenseBudgetStatus items={budgetStatus} />

      <ExpenseFilters
        timezone={tenant.timezone}
        maxDate={today}
        categories={categories}
        activeItems={activeItems}
        paymentMethods={paymentMethods}
        locations={locations}
        canViewAll={canViewAll}
      />

      <ExpenseList
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        timezone={tenant.timezone}
        todayDate={today}
        viewedDate={viewedDate}
        expenses={expenses}
        activeItems={activeItems}
        recentlyUsedItemIds={recentlyUsedItemIds}
        categories={categories}
        paymentMethods={paymentMethods}
        defaultPaymentMethodId={defaultPaymentMethodId}
        knownVendors={knownVendors}
        locations={locations}
        canCreate={canCreate}
        canEdit={canEdit}
        canVoid={canVoid}
        canViewReceipt={canViewReceipt}
        canDownloadReceipt={canDownloadReceipt}
        canViewAll={canViewAll}
        canManageReimbursements={canManageReimbursements}
        budgetStatus={budgetStatus}
      />
    </div>
  );
}
