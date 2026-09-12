import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { ExpenseConfigTabs } from "@/features/expenses/components/expense-config-tabs";
import { ExpenseCategoryService } from "@/services/ExpenseCategoryService";
import { ExpenseItemService } from "@/services/ExpenseItemService";
import { ExpensePaymentMethodService } from "@/services/ExpensePaymentMethodService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Expense Configuration | JMS Sales App",
};

/**
 * Daily Expenses: the configured Expense Items catalog (Water,
 * Electricity, Rent, ...) -- expenses.configure_items-gated, same
 * "redirect cleanly on a direct URL hit, don't error" convention Stock
 * already established (assertInventoryEnabled's own note). See
 * supabase/migrations/0054_daily_expenses.sql and docs/26-daily-expenses.md.
 */
export default async function ExpenseItemsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canConfigure, canManageCategories, canManagePaymentMethods, expensesEnabled] = await Promise.all([
    can("expenses.configure_items", { tenantId: tenant.id }),
    can("expenses.manage_categories", { tenantId: tenant.id }),
    can("expenses.manage_payment_methods", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "expenses_enabled"),
  ]);
  if (!expensesEnabled || (!canConfigure && !canManageCategories && !canManagePaymentMethods)) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const [expenseItems, categories, paymentMethods] = await Promise.all([
    new ExpenseItemService(supabase).listAll(tenant.id),
    new ExpenseCategoryService(supabase).listAll(tenant.id),
    new ExpensePaymentMethodService(supabase).listAll(tenant.id),
  ]);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Expense Configuration</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Configure the expense types, categories, and payment methods your team can record against. Estimated Amount is only a guide -- it never limits what&apos;s actually recorded.
      </p>

      <ExpenseConfigTabs
        tenantId={tenant.id}
        tenantSlug={tenantSlug}
        expenseItems={expenseItems}
        categories={categories}
        paymentMethods={paymentMethods}
        canManageCategories={canManageCategories}
        canManagePaymentMethods={canManagePaymentMethods}
      />
    </div>
  );
}
