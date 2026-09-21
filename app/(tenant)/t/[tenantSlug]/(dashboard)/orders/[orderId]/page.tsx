import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { BackLink } from "@/components/shared/back-link";

import { WhatsAppButton } from "@/components/shared/whatsapp-button";
import { OrderActionPanel } from "@/features/orders/components/order-action-panel";
import { OrderReceiptDialog } from "@/features/orders/components/order-receipt-dialog";
import { OrderStatusBadge, ORDER_STATUS_LABEL } from "@/features/orders/components/order-status-badge";
import { OrderService } from "@/services/OrderService";
import { TenantService } from "@/services/TenantService";
import { buildOrderWhatsAppMessage } from "@/lib/utils/order-whatsapp-messages";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Order | JMS Sales App",
};

/**
 * Customer Orders Phase 2c: order detail + the staff status-transition
 * workflow. The "Being Attended" transition (spec section 17) is
 * deliberately not a button -- it fires here, as a side effect of
 * rendering a 'received' order, using the request-scoped RLS-respecting
 * client so auth.uid() resolves inside attend_order() correctly. Only
 * attempted when the viewer actually holds orders.attend -- someone
 * with read-only access opening a received order should just see it as
 * still "Received", not trigger a permission error server-side.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; orderId: string }>;
}) {
  const { tenantSlug, orderId } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);
  if (!user) {
    redirect("/login");
  }
  if (!tenant) {
    notFound();
  }

  const tenantService = new TenantService(supabase);
  const [canView, canViewAll, ordersEnabled, canAttend, canMarkOnDelivery, canComplete, canCancel, canViewReceipts, canDownloadReceipts, settings] =
    await Promise.all([
      can("orders.view", { tenantId: tenant.id }),
      can("orders.view_all", { tenantId: tenant.id }),
      tenantService.getSetting<boolean>(tenant.id, "orders_enabled"),
      can("orders.attend", { tenantId: tenant.id }),
      can("orders.mark_on_delivery", { tenantId: tenant.id }),
      can("orders.complete", { tenantId: tenant.id }),
      can("orders.cancel", { tenantId: tenant.id }),
      can("orders.view_receipts", { tenantId: tenant.id }),
      can("orders.download_receipts", { tenantId: tenant.id }),
      tenantService.getSettings(tenant.id, ["order_outlet_name", "whatsapp_message_on_delivery", "whatsapp_message_completed"]),
    ]);
  if (!ordersEnabled || (!canView && !canViewAll)) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const orderService = new OrderService(supabase);

  let order = await orderService.getOrderDetail(tenant.id, orderId);
  if (!order) {
    notFound();
  }

  if (order.status === "received" && canAttend) {
    const updatedRow = await orderService.attendOrder(orderId);

    // Patch in-memory rather than re-calling getOrderDetail() -- a
    // second read of the exact same orders/order_items/order_status_
    // history queries within this SAME request would hit React's
    // automatic fetch request memoization and silently return the
    // PRE-mutation response (confirmed live: the DB was correctly
    // updated to being_attended while a naive re-fetch still rendered
    // "Received"). See OrderService.attendOrder's own header comment.
    if (updatedRow.status === "being_attended") {
      const { data: actorProfile } = await supabase.from("profiles").select("full_name").eq("id", updatedRow.attended_by!).maybeSingle();
      order = {
        ...order,
        status: "being_attended",
        attendedBy: updatedRow.attended_by,
        attendedByName: actorProfile?.full_name ?? null,
        attendedAt: updatedRow.attended_at,
        statusHistory: [
          ...order.statusHistory,
          {
            id: `local-attend-${updatedRow.attended_at}`,
            fromStatus: "received",
            toStatus: "being_attended",
            changedBy: updatedRow.attended_by,
            changedByName: actorProfile?.full_name ?? null,
            changedAt: updatedRow.attended_at!,
            notes: null,
          },
        ],
      };
    }
  }

  return (
    // pb-24: the sticky bottom nav (components/shared/bottom-nav.tsx)
    // clamps to the viewport's bottom edge once page content exceeds
    // viewport height, covering the last ~61px of normal flow --
    // confirmed live via elementFromPoint() that a Cancel/Complete
    // button placed right at a tall order's natural content end was
    // receiving clicks intended for it on the nav's "History" link
    // instead. Same app-wide risk as every other `p-6`-only dashboard
    // page, just the first one with enough content + a bottom-edge
    // action button to expose it live -- scoped the fix to Orders here
    // rather than touching the shared layout for every page.
    <div className="flex flex-1 flex-col p-6 pb-24">
      <BackLink href={`/t/${tenantSlug}/orders`} label="Orders" />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{order.orderNumber ?? "Order"}</h1>
          <p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <OrderStatusBadge status={order.status} />
          {canViewReceipts && <OrderReceiptDialog tenantId={tenant.id} orderId={order.id} canDownload={canDownloadReceipts} />}
        </div>
      </div>

      <div className="mb-4 space-y-1 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{order.customerName}</p>
          <WhatsAppButton
            mobile={order.customerMobile}
            message={buildOrderWhatsAppMessage(
              order.status,
              {
                customerName: order.customerName,
                orderNumber: order.orderNumber,
                outletName: (settings.order_outlet_name as string | undefined) || tenant.name,
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
        <p className="text-sm text-muted-foreground">{order.customerMobile}</p>
        <p className="text-sm text-muted-foreground">{order.deliveryLocation}</p>
        {order.deliveryDirections && <p className="text-sm text-muted-foreground">{order.deliveryDirections}</p>}
        {order.orderNotes && <p className="mt-2 text-sm">Note: {order.orderNotes}</p>}
      </div>

      <div className="mb-4 divide-y rounded-lg border">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 p-3">
            <span className="text-sm">{item.productNameSnapshot}</span>
            <span className="text-sm font-medium">{item.requestedAmount.toFixed(2)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 p-3">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-sm font-semibold">{order.orderTotal.toFixed(2)}</span>
        </div>
      </div>

      {order.status === "on_delivery" || order.status === "completed" ? (
        <div className="mb-4 space-y-1 rounded-lg border p-4">
          <p className="text-sm font-medium">Delivery</p>
          <p className="text-sm text-muted-foreground">
            {order.deliveryPersonName} · {order.deliveryPersonMobile}
          </p>
          {order.deliveryNotes && <p className="text-sm text-muted-foreground">{order.deliveryNotes}</p>}
        </div>
      ) : null}

      {order.status === "cancelled" && order.cancellationReason && (
        <div className="mb-4 space-y-1 rounded-lg border p-4">
          <p className="text-sm font-medium">Cancellation reason</p>
          <p className="text-sm text-muted-foreground">{order.cancellationReason}</p>
          {order.cancelledByName && <p className="text-xs text-muted-foreground">By {order.cancelledByName}</p>}
        </div>
      )}

      <div className="mb-4">
        <OrderActionPanel
          tenantSlug={tenantSlug}
          tenantId={tenant.id}
          orderId={order.id}
          status={order.status}
          canMarkOnDelivery={canMarkOnDelivery}
          canComplete={canComplete}
          canCancel={canCancel}
        />
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">Status history</p>
        <div className="space-y-2">
          {order.statusHistory.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <div>
                <p>{ORDER_STATUS_LABEL[entry.toStatus]}</p>
                {entry.changedByName && <p className="text-xs text-muted-foreground">By {entry.changedByName}</p>}
                {entry.notes && <p className="text-xs text-muted-foreground">{entry.notes}</p>}
              </div>
              <p className="text-xs text-muted-foreground">{new Date(entry.changedAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
