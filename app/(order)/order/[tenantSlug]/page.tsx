import type { Metadata } from "next";

import { OrderingStorefront } from "@/features/public-ordering/components/ordering-storefront";
import { PublicOrderingService } from "@/services/PublicOrderingService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata: Metadata = {
  title: "Order | JMS Sales App",
};

/**
 * Fully public -- no getCurrentUser()/redirect call anywhere in this
 * tree (see (order)/layout.tsx's own comment). Always reads through
 * PublicOrderingService on the service-role client; getStorefront()
 * itself collapses "tenant doesn't exist" and "exists but the module/
 * public-ordering flag is off" into the same null result on purpose,
 * so this page can't be used to enumerate real tenant slugs by
 * comparing error messages.
 */
export default async function PublicOrderPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const storefront = await new PublicOrderingService(createServiceRoleClient()).getStorefront(tenantSlug);

  if (!storefront) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
        <p className="text-lg font-medium">This ordering page isn&apos;t available right now.</p>
        <p className="mt-2 text-sm text-muted-foreground">Please check back later or contact the business directly.</p>
      </div>
    );
  }

  return <OrderingStorefront storefront={storefront} />;
}
