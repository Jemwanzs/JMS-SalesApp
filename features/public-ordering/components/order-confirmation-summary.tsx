"use client";

import { useState, useTransition } from "react";
import { ArrowLeft } from "lucide-react";

import { submitOrderAction } from "@/features/public-ordering/actions/submit-order";
import { Button } from "@/components/ui/button";
import type { DeliveryDetails } from "@/features/public-ordering/components/delivery-details-form";
import type { CartLine } from "@/features/public-ordering/components/ordering-storefront";
import type { Storefront, SubmitOrderResult } from "@/services/PublicOrderingService";

/**
 * Final review -> Place Order. isPending disables the button for the
 * whole round trip (prevents a double-tap from firing two submissions
 * client-side); the idempotencyKey (generated once when the storefront
 * mounted, unchanged across this whole flow) is the real backstop
 * against a network retry creating a duplicate order server-side --
 * see PublicOrderingService.submitOrder's own header comment.
 */
export function OrderConfirmationSummary({
  storefront,
  cart,
  delivery,
  idempotencyKey,
  onBack,
  onSuccess,
}: {
  storefront: Storefront;
  cart: CartLine[];
  delivery: DeliveryDetails;
  idempotencyKey: string;
  onBack: () => void;
  onSuccess: (result: SubmitOrderResult) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const total = cart.reduce((sum, l) => sum + l.requestedAmount, 0);

  function onPlaceOrder() {
    setError(null);
    const formData = new FormData();
    formData.set("tenantSlug", storefront.tenantSlug);
    formData.set("customerName", delivery.name);
    formData.set("mobileNumber", delivery.mobileNumber);
    formData.set("deliveryLocation", delivery.deliveryLocation);
    formData.set("deliveryDirections", delivery.deliveryDirections);
    formData.set("orderNotes", delivery.orderNotes);
    formData.set("idempotencyKey", idempotencyKey);
    formData.set("items", JSON.stringify(cart.map((l) => ({ orderProductId: l.orderProductId, requestedAmount: l.requestedAmount }))));

    startTransition(async () => {
      const result = await submitOrderAction({}, formData);
      if (result.result) {
        onSuccess(result.result);
        return;
      }
      // A failed submission here almost always means a stale/removed
      // cart item or minimum-order change since browsing started (the
      // server re-validates everything fresh, see PublicOrderingService.
      // submitOrder) -- Back takes the customer to the cart to fix it.
      setError(result.error || Object.values(result.fieldErrors ?? {})[0] || "Could not place your order.");
    });
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" disabled={isPending}>
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <h2 className="mb-4 text-lg font-semibold">Order Summary</h2>

      <div className="space-y-3">
        <div className="rounded-lg border p-3">
          <p className="text-sm text-muted-foreground">{cart.length} Item{cart.length === 1 ? "" : "s"}</p>
          <p className="mt-1 text-sm text-muted-foreground">Order Value</p>
          <p className="text-lg font-semibold">{total.toFixed(2)}</p>
        </div>

        <div className="rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground">Delivery Fee</p>
          <p className="text-sm">Paid separately on delivery</p>
        </div>

        <div className="rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground">Deliver To</p>
          <p className="text-sm">{delivery.deliveryLocation}</p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="button" className="w-full" onClick={onPlaceOrder} disabled={isPending}>
          {isPending ? "Placing Order..." : "Place Order"}
        </Button>
      </div>
    </div>
  );
}
