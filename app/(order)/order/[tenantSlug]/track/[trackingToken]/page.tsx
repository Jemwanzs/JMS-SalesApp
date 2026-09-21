import type { Metadata } from "next";

import { OrderTrackingView } from "@/features/public-ordering/components/order-tracking-view";
import { PublicOrderingService } from "@/services/PublicOrderingService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Track Order | JMS Sales App",
};

/**
 * Customer Orders Phase 2d: the public tracking page the success
 * screen's "Track My Order" link points to. Fully public, same posture
 * as the storefront page itself -- no auth check anywhere in this tree
 * (see (order)/layout.tsx), always through PublicOrderingService on the
 * service-role client. getOrderByTrackingToken() collapses every
 * failure mode (tenant inactive, module off, unknown/wrong token) into
 * the same null result so this page can't be used to probe which
 * tracking tokens are valid.
 */
export default async function TrackOrderPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; trackingToken: string }>;
}) {
  const { tenantSlug, trackingToken } = await params;
  const order = await new PublicOrderingService(createServiceRoleClient()).getOrderByTrackingToken(tenantSlug, trackingToken);

  if (!order) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-lg font-medium">We couldn&apos;t find that order.</p>
        <p className="mt-2 text-sm text-muted-foreground">Double check the link, or contact the business directly.</p>
      </div>
    );
  }

  return <OrderTrackingView order={order} />;
}
