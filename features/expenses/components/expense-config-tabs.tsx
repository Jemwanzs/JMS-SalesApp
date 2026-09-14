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
          overflowing off the right edge. The shared TabsList's fixed
          height comes from a `group-data-horizontal/tabs:h-8` variant
          selector, which beats a plain `h-auto` override on specificity
          alone regardless of class order -- so without `!` the list
          stayed locked at one row's height and the wrapped second row
          rendered outside its bg-muted pill entirely (no background,
          overlapping whatever sat below). Same story for each trigger's
          `h-[calc(100%-1px)]` (sized against the WHOLE list, i.e. both
          rows, once wrapped) vs. a fixed `h-8` per trigger. `!important`
          on both makes the override actually win. Scoped to this
          component only, not the shared components/ui/tabs.tsx
          primitive, since StockTabs/Analytics/Imports all fit their
          fewer tabs on one line already and shouldn't wrap. */}
      <TabsList className="!h-auto w-full flex-wrap justify-center gap-1.5 pb-1.5">
        <TabsTrigger value="items" className="!h-8 flex-none px-3">
          Items
        </TabsTrigger>
        {canManageCategories && (
          <TabsTrigger value="categories" className="!h-8 flex-none px-3">
            Categories
          </TabsTrigger>
        )}
        {canManagePaymentMethods && (
          <TabsTrigger value="payment-methods" className="!h-8 flex-none px-3">
            Payment Methods
          </TabsTrigger>
        )}
        {canManageBudgets && (
          <TabsTrigger value="budgets" className="!h-8 flex-none px-3">
            Budgets
          </TabsTrigger>
        )}
        {canManageRecurring && (
          <TabsTrigger value="recurring" className="!h-8 flex-none px-3">
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
