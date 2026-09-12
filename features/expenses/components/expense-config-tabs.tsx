"use client";

import { ExpenseCategoryManagementList } from "@/features/expenses/components/expense-category-management-list";
import { ExpenseItemManagementList } from "@/features/expenses/components/expense-item-management-list";
import { ExpensePaymentMethodManagementList } from "@/features/expenses/components/expense-payment-method-management-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ExpenseCategory } from "@/services/ExpenseCategoryService";
import type { ExpenseItem } from "@/services/ExpenseItemService";
import type { ExpensePaymentMethod } from "@/services/ExpensePaymentMethodService";

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
  canManageCategories,
  canManagePaymentMethods,
}: {
  tenantId: string;
  tenantSlug: string;
  expenseItems: ExpenseItem[];
  categories: ExpenseCategory[];
  paymentMethods: ExpensePaymentMethod[];
  canManageCategories: boolean;
  canManagePaymentMethods: boolean;
}) {
  return (
    <Tabs defaultValue="items">
      <TabsList className="w-full">
        <TabsTrigger value="items">Items</TabsTrigger>
        {canManageCategories && <TabsTrigger value="categories">Categories</TabsTrigger>}
        {canManagePaymentMethods && <TabsTrigger value="payment-methods">Payment Methods</TabsTrigger>}
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
    </Tabs>
  );
}
