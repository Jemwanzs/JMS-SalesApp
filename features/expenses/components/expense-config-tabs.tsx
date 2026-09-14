"use client";

import { ExpenseBudgetManagementList } from "@/features/expenses/components/expense-budget-management-list";
import { ExpenseCategoryManagementList } from "@/features/expenses/components/expense-category-management-list";
import { ExpenseItemManagementList } from "@/features/expenses/components/expense-item-management-list";
import { ExpensePaymentMethodManagementList } from "@/features/expenses/components/expense-payment-method-management-list";
import { ExpenseRecurringTemplateManagementList } from "@/features/expenses/components/expense-recurring-template-management-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ExpenseBudget } from "@/services/ExpenseBudgetService";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { ExpenseItem } from "@/services/ExpenseItemService";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";
import type { ExpenseRecurringTemplate } from "@/services/ExpenseRecurringTemplateService";
import type { LocationSummary } from "@/services/LocationService";

/**
 * Items / Categories / Payment Methods as tabs of one screen rather than
 * three separate "More" menu entries -- keeps menu clutter down on this
 * ~430px-first app (same reasoning StockTabs already established for
 * Stock's own sub-screens).
 */
export function ExpenseConfigTabs({
  tenantId,
  tenantSlug,
  expenseItems,
  categories,
  paymentMethods,
  budgets,
  recurringTemplates,
  knownVendors,
  locations,
  canManageCategories,
  canManagePaymentMethods,
  canManageBudgets,
  canManageRecurring,
}: {
  tenantId: string;
  tenantSlug: string;
  expenseItems: ExpenseItem[];
  categories: ExpenseCategory[];
  paymentMethods: ExpensePaymentMethod[];
  budgets: ExpenseBudget[];
  recurringTemplates: ExpenseRecurringTemplate[];
  knownVendors: string[];
  locations: LocationSummary[];
  canManageCategories: boolean;
  canManagePaymentMethods: boolean;
  canManageBudgets: boolean;
  canManageRecurring: boolean;
}) {
  return (
    <Tabs defaultValue="items">
      {/* Up to 5 tabs here (more than any other TabsList in the app) --
          wraps onto a second, centered row on narrow screens instead of
          overflowing off the right edge. flex-none on each trigger (vs.
          the shared TabsList's default flex-1) so a short row like a
          lone "Items" doesn't stretch to fill it; scoped to this
          component only, not the shared components/ui/tabs.tsx
          primitive, since StockTabs/Analytics/Imports all fit their
          fewer tabs on one line already and shouldn't wrap. */}
      <TabsList className="h-auto w-full flex-wrap justify-center gap-1.5">
        <TabsTrigger value="items" className="flex-none px-3">
          Items
        </TabsTrigger>
        {canManageCategories && (
          <TabsTrigger value="categories" className="flex-none px-3">
            Categories
          </TabsTrigger>
        )}
        {canManagePaymentMethods && (
          <TabsTrigger value="payment-methods" className="flex-none px-3">
            Payment Methods
          </TabsTrigger>
        )}
        {canManageBudgets && (
          <TabsTrigger value="budgets" className="flex-none px-3">
            Budgets
          </TabsTrigger>
        )}
        {canManageRecurring && (
          <TabsTrigger value="recurring" className="flex-none px-3">
            Recurring
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent value="items" className="pt-4">
        <ExpenseItemManagementList tenantId={tenantId} tenantSlug={tenantSlug} expenseItems={expenseItems} categories={categories} />
      </TabsContent>

      {canManageCategories && (
        <TabsContent value="categories" className="pt-4">
          <ExpenseCategoryManagementList tenantId={tenantId} tenantSlug={tenantSlug} categories={categories} />
        </TabsContent>
      )}

      {canManagePaymentMethods && (
        <TabsContent value="payment-methods" className="pt-4">
          <ExpensePaymentMethodManagementList tenantId={tenantId} tenantSlug={tenantSlug} paymentMethods={paymentMethods} />
        </TabsContent>
      )}

      {canManageBudgets && (
        <TabsContent value="budgets" className="pt-4">
          <ExpenseBudgetManagementList tenantId={tenantId} tenantSlug={tenantSlug} budgets={budgets} categories={categories} locations={locations} />
        </TabsContent>
      )}

      {canManageRecurring && (
        <TabsContent value="recurring" className="pt-4">
          <ExpenseRecurringTemplateManagementList
            tenantId={tenantId}
            tenantSlug={tenantSlug}
            templates={recurringTemplates}
            expenseItems={expenseItems}
            categories={categories}
            paymentMethods={paymentMethods}
            knownVendors={knownVendors}
            locations={locations}
          />
        </TabsContent>
      )}
    </Tabs>
  );
}
