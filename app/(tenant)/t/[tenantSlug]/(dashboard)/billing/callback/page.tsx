import type { Metadata } from "next";

import { CheckoutCallback } from "@/features/billing/components/checkout-callback";

export const metadata: Metadata = {
  title: "Payment | JMS Sales App",
};

/**
 * Paystack redirects here after checkout, regardless of outcome. This
 * page never itself declares success -- docs/14-billing-paystack.md:
 * "payment status is never derived from a frontend success screen."
 * The real transition happens asynchronously via the webhook; this is
 * just a waiting/redirect screen back to the real billing page, whose
 * data always comes from a fresh server read.
 */
export default async function BillingCallbackPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <CheckoutCallback tenantSlug={tenantSlug} />
    </div>
  );
}
