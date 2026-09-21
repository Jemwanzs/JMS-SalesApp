"use client";

import { CheckCircle2 } from "lucide-react";

import type { Storefront, SubmitOrderResult } from "@/services/PublicOrderingService";

/**
 * "Track My Order" is deliberately inert here -- the real tracking
 * page (/order/{slug}/track/{token}) is Phase 2d, not built yet. Shown
 * as a disabled affordance with a short note rather than a working
 * link to a route that doesn't exist, so this phase never ships a
 * dead link; swap this for a real <Link> once 2d lands.
 */
export function OrderSuccessScreen({ storefront, result }: { storefront: Storefront; result: SubmitOrderResult }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
      <CheckCircle2 className="h-12 w-12 text-emerald-500" />
      <h1 className="mt-4 text-lg font-semibold">Order Received</h1>
      <p className="mt-1 text-sm font-medium">Order #{result.orderNumber}</p>
      <p className="mt-1 text-2xl font-semibold">{result.orderTotal.toFixed(2)}</p>

      <p className="mt-4 text-sm text-muted-foreground">
        Thank you! Your order has been received by {storefront.outletName}. Our team will attend to it shortly.
      </p>

      <button
        type="button"
        disabled
        className="mt-6 w-full max-w-xs cursor-not-allowed rounded-full border px-4 py-2 text-sm text-muted-foreground opacity-60"
        title="Order tracking is coming soon"
      >
        Track My Order (coming soon)
      </button>
    </div>
  );
}
