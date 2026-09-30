"use client";

import { ClipboardList, ShoppingBag } from "lucide-react";

/**
 * Shown right after a mobile number is identified -- "My Orders"
 * always renders, even for a brand-new number with 0 past orders (the
 * list screen itself shows a clear empty state + its own Order Now
 * button rather than hiding this choice conditionally).
 */
export function CustomerOrderChoice({
  totalOrderCount,
  onViewOrders,
  onOrderNow,
  onChangeNumber,
}: {
  totalOrderCount: number;
  onViewOrders: () => void;
  onOrderNow: () => void;
  onChangeNumber: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3 p-6">
      <button
        type="button"
        onClick={onViewOrders}
        className="flex items-center gap-3 rounded-lg border p-4 text-left hover:bg-muted"
      >
        <ClipboardList className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">My Orders</p>
          <p className="text-xs text-muted-foreground">
            {totalOrderCount > 0 ? `You've ordered ${totalOrderCount} time${totalOrderCount === 1 ? "" : "s"} with us` : "No orders yet"}
          </p>
        </div>
      </button>

      <button
        type="button"
        onClick={onOrderNow}
        className="flex items-center gap-3 rounded-lg border p-4 text-left hover:bg-muted"
      >
        <ShoppingBag className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">Order Now</p>
          <p className="text-xs text-muted-foreground">Browse products and place a new order</p>
        </div>
      </button>

      <button type="button" onClick={onChangeNumber} className="mt-2 text-center text-xs text-muted-foreground hover:text-foreground">
        Not you? Enter a different number
      </button>
    </div>
  );
}
