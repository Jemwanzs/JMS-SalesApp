import { CheckCircle2, Circle, XCircle } from "lucide-react";

import type { TrackedOrder } from "@/services/PublicOrderingService";
import type { OrderStatus } from "@/types/database.types";

const STATUS_LABEL: Record<OrderStatus, string> = {
  received: "Order received",
  being_attended: "Being prepared",
  on_delivery: "On delivery",
  completed: "Delivered",
  cancelled: "Cancelled",
  rejected: "Rejected",
};

// The normal, non-cancelled progression this page walks a customer
// through -- deliberately its own small list rather than importing the
// staff-side order-status-badge component (features/orders), matching
// this codebase's existing convention of feature folders not importing
// from one another.
const PROGRESSION: OrderStatus[] = ["received", "being_attended", "on_delivery", "completed"];

export function OrderTrackingView({ order }: { order: TrackedOrder }) {
  const isCancelled = order.status === "cancelled" || order.status === "rejected";
  const currentIndex = PROGRESSION.indexOf(order.status);

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 text-center">
        <p className="text-sm text-muted-foreground">{order.orderNumber ?? "Your order"}</p>
        <h1 className="mt-1 text-lg font-semibold">{STATUS_LABEL[order.status]}</h1>
      </div>

      {isCancelled ? (
        <div className="mb-6 flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
          <XCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">This order was cancelled</p>
          {order.cancellationReason && <p className="text-xs text-muted-foreground">{order.cancellationReason}</p>}
        </div>
      ) : (
        <div className="mb-6 space-y-3">
          {PROGRESSION.map((status, i) => {
            const reached = i <= currentIndex;
            return (
              <div key={status} className="flex items-center gap-3">
                {reached ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                )}
                <span className={reached ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{STATUS_LABEL[status]}</span>
              </div>
            );
          })}
        </div>
      )}

      {order.status === "on_delivery" && order.deliveryPersonName && (
        <div className="mb-6 space-y-1 rounded-lg border p-4">
          <p className="text-sm font-medium">On the way</p>
          <p className="text-sm text-muted-foreground">
            {order.deliveryPersonName}
            {order.deliveryPersonMobile ? ` · ${order.deliveryPersonMobile}` : ""}
          </p>
        </div>
      )}

      <div className="mb-6 space-y-1 rounded-lg border p-4">
        <p className="mb-2 text-sm font-medium">Delivering to</p>
        <p className="text-sm text-muted-foreground">{order.deliveryLocation}</p>
      </div>

      <div className="divide-y rounded-lg border">
        {order.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between gap-3 p-3">
            <span className="text-sm">{item.productNameSnapshot}</span>
            <span className="text-sm font-medium">{item.requestedAmount.toFixed(2)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 p-3">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-sm font-semibold">{order.orderTotal.toFixed(2)}</span>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">Reload this page any time for the latest status.</p>
    </div>
  );
}
