import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";
import { WhatsAppButton } from "@/components/shared/whatsapp-button";

import { OrderFilters } from "@/features/orders/components/order-filters";
import { OrderStatusBadge } from "@/features/orders/components/order-status-badge";
import { OrderService, type OrderFilters as OrderFiltersInput } from "@/services/OrderService";
import { TenantService } from "@/services/TenantService";
import { buildOrderWhatsAppMessage } from "@/lib/utils/order-whatsapp-messages";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";
import type { OrderStatus } from "@/types/database.types";

export const metadata: Metadata = {
  title: "Orders | JMS Sales App",
};

const COUNT_TILES: { status: OrderStatus; label: string }[] = [
  { status: "received", label: "Received" },
  { status: "being_attended", label: "Being Attended" },
  { status: "on_delivery", label: "On Delivery" },
  { status: "completed", label: "Completed" },
];

/**
 * Customer Orders Phase 2c: staff order management dashboard.
 * Gated on orders_enabled + (orders.view or orders.view_all) -- there is
 * no per-branch distinction between those two permissions here (Orders
 * is deliberately not branch-scoped, unlike Sales), both just admit
 * entry to the same tenant-wide dashboard.
 */
export default async function OrdersDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ status?: string; q?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const { tenantSlug } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const tenantService = new TenantService(supabase);
  const [canView, canViewAll, ordersEnabled, settings] = await Promise.all([
    can("orders.view", { tenantId: tenant.id }),
    can("orders.view_all", { tenantId: tenant.id }),
    tenantService.getSetting<boolean>(tenant.id, "orders_enabled"),
    tenantService.getSettings(tenant.id, ["order_outlet_name", "whatsapp_message_on_delivery", "whatsapp_message_completed"]),
  ]);
  if (!ordersEnabled || (!canView && !canViewAll)) {
    redirect(`/t/${tenantSlug}/more`);
  }
  const outletName = (settings.order_outlet_name as string | undefined) || tenant.name;

  const orderService = new OrderService(supabase);

  const filters: OrderFiltersInput = {
    status: (query.status as OrderStatus | undefined) || undefined,
    search: query.q || undefined,
    dateFrom: query.dateFrom ? `${query.dateFrom}T00:00:00.000Z` : undefined,
    dateTo: query.dateTo ? `${query.dateTo}T23:59:59.999Z` : undefined,
  };

  const [counts, orders] = await Promise.all([orderService.getCounts(tenant.id), orderService.listOrders(tenant.id, filters)]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    // pb-24 clears the sticky bottom nav on a tall filtered list -- see
    // orders/[orderId]/page.tsx's own header comment for the live bug
    // this guards against.
    <div className="flex flex-1 flex-col p-6 pb-24">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="mb-4 text-xl font-semibold">Orders</h1>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {COUNT_TILES.map((tile) => (
          <Link
            key={tile.status}
            href={`/t/${tenantSlug}/orders?status=${tile.status}`}
            className="rounded-lg border p-3 text-center hover:bg-muted"
          >
            <p className="text-2xl font-semibold">{counts[toCountKey(tile.status)]}</p>
            <p className="text-xs text-muted-foreground">{tile.label}</p>
          </Link>
        ))}
      </div>

      <OrderFilters maxDate={today} />

      {orders.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
          <p className="text-sm text-muted-foreground">No orders match these filters.</p>
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {orders.map((order) => (
            // "Stretched link" pattern: the Link becomes an invisible
            // full-row click target (absolute inset-0) instead of
            // wrapping everything, so the WhatsAppButton can be its own
            // independently-clickable <a> without nesting anchors
            // (invalid HTML) -- it needs relative z-10 to stack above
            // the Link overlay. See this module's own plan notes for
            // why (Phase 3b, WhatsApp click-to-chat).
            <div key={order.id} className="relative flex items-center justify-between gap-3 p-4">
              <Link
                href={`/t/${tenantSlug}/orders/${order.id}`}
                className="absolute inset-0 hover:bg-muted"
                aria-label={order.orderNumber ?? "Order"}
              />
              <div>
                <p className="text-sm font-medium">{order.orderNumber ?? "Order"}</p>
                <p className="text-xs text-muted-foreground">
                  {order.customerName} · {order.customerMobile}
                </p>
                <p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex flex-col items-end gap-1">
                  <p className="text-sm font-medium">{order.orderTotal.toFixed(2)}</p>
                  <OrderStatusBadge status={order.status} />
                </div>
                <WhatsAppButton
                  mobile={order.customerMobile}
                  message={buildOrderWhatsAppMessage(
                    order.status,
                    {
                      customerName: order.customerName,
                      orderNumber: order.orderNumber,
                      outletName,
                      orderTotal: order.orderTotal,
                      deliveryLocation: order.deliveryLocation,
                    },
                    {
                      onDeliveryTemplate: settings.whatsapp_message_on_delivery as string | undefined,
                      completedTemplate: settings.whatsapp_message_completed as string | undefined,
                    }
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function toCountKey(status: OrderStatus): "received" | "beingAttended" | "onDelivery" | "completed" {
  switch (status) {
    case "received":
      return "received";
    case "being_attended":
      return "beingAttended";
    case "on_delivery":
      return "onDelivery";
    default:
      return "completed";
  }
}
