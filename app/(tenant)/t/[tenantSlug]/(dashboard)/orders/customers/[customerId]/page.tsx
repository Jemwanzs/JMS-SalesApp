import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";
import { WhatsAppButton } from "@/components/shared/whatsapp-button";

import { Collapsible, CollapsibleTrigger, CollapsiblePanel } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

import { CustomerTierBadge, TopCustomerStars } from "@/features/orders/components/customer-tier-badge";
import { OrderStatusBadge } from "@/features/orders/components/order-status-badge";
import { OrderService } from "@/services/OrderService";
import { TenantService } from "@/services/TenantService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Customer | JMS Sales App",
};

export default async function OrderCustomerDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; customerId: string }>;
}) {
  const { tenantSlug, customerId } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const [canViewCustomers, ordersEnabled] = await Promise.all([
    can("orders.view_customers", { tenantId: tenant.id }),
    new TenantService(supabase).getSetting<boolean>(tenant.id, "orders_enabled"),
  ]);
  if (!ordersEnabled || !canViewCustomers) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const customer = await new OrderService(supabase).getCustomerDetail(tenant.id, customerId);
  if (!customer) {
    notFound();
  }

  return (
    // pb-24 clears the sticky bottom nav -- see orders/[orderId]/page.tsx's own header comment.
    <div className="flex flex-1 flex-col p-6 pb-24">
      <BackLink href={`/t/${tenantSlug}/orders/customers`} label="Customers" />

      <div className="mb-4 space-y-1 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{customer.name}</h1>
          <WhatsAppButton mobile={customer.mobileNumber} />
        </div>
        <p className="text-sm text-muted-foreground">{customer.mobileNumber}</p>
        {customer.defaultDeliveryLocation && <p className="text-sm text-muted-foreground">{customer.defaultDeliveryLocation}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <p className="text-lg font-semibold">{customer.orderCount}</p>
            <p className="text-xs text-muted-foreground">Orders</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{customer.totalOrdered.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">Total ordered</p>
          </div>
        </div>
      </div>

      {/* Collapsed by default (spec section 8: "visible after clicking on the customer to see the collapsed information"). */}
      <Collapsible className="mb-4 rounded-lg border p-4">
        <CollapsibleTrigger className="group flex w-full items-center justify-between text-sm font-medium">
          Customer Performance
          <ChevronDown className="h-4 w-4 transition-transform group-data-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsiblePanel className="space-y-3 pt-3">
          {customer.isTopCustomer && <TopCustomerStars className="block text-lg text-amber-500" />}
          <p className="text-sm">
            <CustomerTierBadge tier={customer.tier} />
            {customer.tier && customer.rank > 0 && ` — #${customer.rank}`}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-lg font-semibold">{customer.completedOrderCount}</p>
              <p className="text-xs text-muted-foreground">Completed Orders</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{customer.completedOrderValue.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Total Ordered</p>
            </div>
            <div>
              <p className="text-lg font-semibold">{customer.averageCompletedOrderValue.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground">Average Order</p>
            </div>
            <div>
              <p className="text-lg font-semibold">
                {customer.lastCompletedOrderAt ? new Date(customer.lastCompletedOrderAt).toLocaleDateString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Last Order</p>
            </div>
          </div>
        </CollapsiblePanel>
      </Collapsible>

      <p className="mb-2 text-sm font-medium">Order history</p>
      {customer.orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {customer.orders.map((order) => (
            <Link
              key={order.id}
              href={`/t/${tenantSlug}/orders/${order.id}`}
              className="flex items-center justify-between gap-3 p-4 hover:bg-muted"
            >
              <div>
                <p className="text-sm font-medium">{order.orderNumber ?? "Order"}</p>
                <p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <p className="text-sm font-medium">{order.orderTotal.toFixed(2)}</p>
                <OrderStatusBadge status={order.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
