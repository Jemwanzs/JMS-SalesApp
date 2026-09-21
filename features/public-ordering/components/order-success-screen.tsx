"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";

import type { Storefront, SubmitOrderResult } from "@/services/PublicOrderingService";

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

      <Link
        href={`/order/${storefront.tenantSlug}/track/${result.trackingToken}`}
        className="mt-6 w-full max-w-xs rounded-full border px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Track My Order
      </Link>
    </div>
  );
}
