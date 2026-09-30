"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { CustomerOrderHistory } from "@/services/PublicOrderingService";
import type { OrderStatus } from "@/types/database.types";

// Same small map order-tracking-view.tsx keeps for itself -- feature
// components in this codebase deliberately don't import from one
// another over a 6-line constant.
const STATUS_LABEL: Record<OrderStatus, string> = {
  received: "Order received",
  being_attended: "Being prepared",
  on_delivery: "On delivery",
  completed: "Delivered",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

/**
 * Last 3 orders only (spec) -- each links straight into the EXISTING
 * per-order tracking page via its own tracking_token, so no new
 * tracking UI is needed here, just this compact list. Deliberately
 * shows no delivery address/items here -- that detail stays behind the
 * same tracking-token link as a freshly-placed order's own success
 * screen, keeping what's visible from a bare mobile-number lookup
 * minimal (see this feature's own security note in
 * PublicOrderingService.getCustomerOrderHistory).
 */
export function CustomerOrderHistoryList({
  tenantSlug,
  history,
  onBack,
  onOrderNow,
}: {
  tenantSlug: string;
  history: CustomerOrderHistory;
  onBack: () => void;
  onOrderNow: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col p-6">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      <h2 className="mb-1 text-lg font-semibold">My Orders</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {history.totalOrderCount > 0
          ? `You've ordered ${history.totalOrderCount} time${history.totalOrderCount === 1 ? "" : "s"} with us. Showing your ${history.recentOrders.length === 1 ? "most recent order" : `${history.recentOrders.length} most recent orders`}.`
          : "You haven't placed an order with us yet."}
      </p>

      {history.recentOrders.length > 0 && (
        <div className="mb-4 divide-y rounded-lg border">
          {history.recentOrders.map((order) => (
            <Link
              key={order.trackingToken}
              href={`/order/${tenantSlug}/track/${order.trackingToken}`}
              className="flex items-center justify-between gap-3 p-4 hover:bg-muted"
            >
              <div>
                <p className="text-sm font-medium">{order.orderNumber ?? "Order"}</p>
                <p className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{order.orderTotal.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{STATUS_LABEL[order.status]}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Button type="button" onClick={onOrderNow} className="w-full">
        Order Now
      </Button>
    </div>
  );
}
