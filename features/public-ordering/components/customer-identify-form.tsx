"use client";

import { useState, useTransition } from "react";

import { lookupCustomerOrdersAction } from "@/features/public-ordering/actions/lookup-customer-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CustomerOrderHistory } from "@/services/PublicOrderingService";

/**
 * The storefront's landing gate -- every visitor enters their mobile
 * number before reaching My Orders / Order Now, whether or not they've
 * ordered before (a brand-new number just gets an empty My Orders, see
 * CustomerOrderChoice). isPending disables the button for the round
 * trip, same convention OrderConfirmationSummary's own submit already
 * uses.
 */
export function CustomerIdentifyForm({
  tenantSlug,
  initialMobileNumber,
  onIdentified,
}: {
  tenantSlug: string;
  initialMobileNumber: string;
  onIdentified: (mobileNumber: string, history: CustomerOrderHistory) => void;
}) {
  const [mobileNumber, setMobileNumber] = useState(initialMobileNumber);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("tenantSlug", tenantSlug);
    formData.set("mobileNumber", mobileNumber);

    startTransition(async () => {
      const result = await lookupCustomerOrdersAction({}, formData);
      if (result.result) {
        onIdentified(mobileNumber.trim(), result.result);
        return;
      }
      setError(result.error || Object.values(result.fieldErrors ?? {})[0] || "Could not continue. Please try again.");
    });
  }

  return (
    <div className="flex flex-1 flex-col justify-center p-6">
      <h2 className="mb-1 text-lg font-semibold">Welcome</h2>
      <p className="mb-4 text-sm text-muted-foreground">Enter the mobile number you used to order with us before (or will use this time).</p>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="identify-mobile">Mobile Number</Label>
          <Input
            id="identify-mobile"
            type="tel"
            value={mobileNumber}
            onChange={(e) => setMobileNumber(e.target.value)}
            placeholder="07XXXXXXXX"
            required
            autoFocus
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Checking..." : "Continue"}
        </Button>
      </form>
    </div>
  );
}
