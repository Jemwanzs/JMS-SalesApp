import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { OrderProductConfigList } from "@/features/orders/components/order-product-config-list";
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
 * Order Products is a thin config layer over the tenant's real Products
 * catalogue -- every active, non-system product shows up here
 * immediately (available by default, minimum 0), no separate name/
 * photo entry required. See supabase/migrations/
 * 0095_order_products_reference_catalogue.sql and OrderProductService's
 * own header comment for why.
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

  const products = await new OrderProductService(supabase).listOrderableProducts(tenant.id);
  const readyCount = products.filter((p) => p.isAvailable && p.minimumOrderAmount > 0).length;

  return (
    <div className="flex flex-1 flex-col p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Order Products</h1>

      {products.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-medium">You don&apos;t have any products yet</p>
          <p className="text-sm text-muted-foreground">
            Add products in your Products list first, then come back here to choose which ones customers can order.
          </p>
          <Link href={`/t/${tenantSlug}/products`} className="text-sm font-medium text-primary underline">
            Go to Products
          </Link>
        </div>
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            Your existing products, reused here for ordering -- no need to recreate them. Only products marked Ordering and given a
            minimum order value above KES 0 appear on your public ordering page.
          </p>
          {readyCount === 0 && (
            <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Set up products for ordering: set a minimum order value for each product you want customers to be able to order.
            </p>
          )}
          <OrderProductConfigList tenantId={tenant.id} tenantSlug={tenantSlug} products={products} />
        </>
      )}
    </div>
  );
}
