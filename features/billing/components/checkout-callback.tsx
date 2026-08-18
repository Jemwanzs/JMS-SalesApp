"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

/**
 * Redirects back to the real billing page after a short pause -- long
 * enough for Paystack's webhook to have realistically reached us and
 * been processed already in the common case, but the billing page
 * itself is what shows the real (server-read) status either way, not
 * this timer.
 */
export function CheckoutCallback({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.push(`/t/${tenantSlug}/billing`);
      router.refresh();
    }, 3000);
    return () => clearTimeout(timer);
  }, [router, tenantSlug]);

  return (
    <>
      <p className="text-sm text-muted-foreground">Confirming your payment...</p>
      <Button variant="outline" onClick={() => router.push(`/t/${tenantSlug}/billing`)}>
        Back to Billing
      </Button>
    </>
  );
}
