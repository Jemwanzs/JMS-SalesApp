import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { OrderProductManagementList } from "@/features/orders/components/order-product-management-list";
import { OrderProductService } from "@/services/OrderProductService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Order Products | JMS Sales App",
};

/**
 * Customer Orders Phase 2a: the Order Products catalogue config screen
 * -- orders.manage_products-gated, same "redirect cleanly on a direct
 * URL hit rather than error" convention expense-items/page.tsx already
 * establishes. See supabase/migrations/0092_orders_module_foundations.sql.
 */
export default async function OrderProductsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canManageProducts, ordersEnabled] = await Promise.all([
    can("orders.manage_products", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "orders_enabled"),
  ]);
  if (!ordersEnabled || !canManageProducts) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const orderProducts = await new OrderProductService(supabase).listAll(tenant.id);

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Order Products</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        The catalogue customers see on your public ordering page. Only active + available products appear there.
      </p>

      <OrderProductManagementList tenantId={tenant.id} tenantSlug={tenantSlug} orderProducts={orderProducts} />
    </div>
  );
}
