import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";
import { BarChart3 } from "lucide-react";

import { ExpenseFilters } from "@/features/expenses/components/expense-filters";
import { ExpenseList } from "@/features/expenses/components/expense-list";
import { ExpenseItemService } from "@/services/ExpenseItemService";
import { ExpenseService } from "@/services/ExpenseService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import { todayString } from "@/lib/utils/date-ranges";

export const metadata: Metadata = {
  title: "Expenses | JMS Sales App",
};

/**
 * Daily Expenses list -- expenses.view-gated, defaults to today with no
 * day-closure gate anywhere (spec: "No day closure should be required
 * before expense reports or analytics can be viewed"). See
 * supabase/migrations/0054_daily_expenses.sql and docs/26-daily-expenses.md.
 */
export default async function ExpensesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ date?: string; q?: string }>;
}) {
  const { tenantSlug } = await params;
  const { date, q } = await searchParams;
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

  const today = todayString(tenant.timezone);
  const viewedDate = date || today;

  const [canCreate, canEdit, canVoid, canViewAnalytics, expenses, activeItems] = await Promise.all([
    can("expenses.create", { tenantId: tenant.id }),
    can("expenses.edit", { tenantId: tenant.id }),
    can("expenses.void", { tenantId: tenant.id }),
    can("expenses.view_analytics", { tenantId: tenant.id }),
    new ExpenseService(supabase).listExpenses(tenant.id, { date: viewedDate, q }),
    new ExpenseItemService(supabase).listActive(tenant.id),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Expenses</h1>
        {canViewAnalytics && (
          <Link
            href={`/t/${tenantSlug}/expenses/analytics?date=${viewedDate}`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <BarChart3 className="h-4 w-4" />
            Summary
          </Link>
        )}
      </div>

      <ExpenseFilters todayDate={today} />

      <ExpenseList
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        timezone={tenant.timezone}
        todayDate={today}
        viewedDate={viewedDate}
        expenses={expenses}
        activeItems={activeItems}
        canCreate={canCreate}
        canEdit={canEdit}
        canVoid={canVoid}
      />
    </div>
  );
}
