"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface DeliveryDetails {
  name: string;
  mobileNumber: string;
  deliveryLocation: string;
  deliveryDirections: string;
  orderNotes: string;
}

/**
 * This IS the spec's "lightweight customer registration" (name +
 * mobile + delivery location) -- collected here, at checkout, not as
 * a separate gate before browsing (spec section 5 says "before
 * submitting the FIRST order," and this form already asks for the
 * same fields section 10 lists). The delivery-fee acknowledgment
 * checkbox gates the CTA -- required per spec section 11, not just
 * informational text.
 */
export function DeliveryDetailsForm({
  initial,
  deliveryFeeNotice,
  onBack,
  onContinue,
}: {
  initial: DeliveryDetails | null;
  deliveryFeeNotice: string;
  onBack: () => void;
  onContinue: (details: DeliveryDetails) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [mobileNumber, setMobileNumber] = useState(initial?.mobileNumber ?? "");
  const [deliveryLocation, setDeliveryLocation] = useState(initial?.deliveryLocation ?? "");
  const [deliveryDirections, setDeliveryDirections] = useState(initial?.deliveryDirections ?? "");
  const [orderNotes, setOrderNotes] = useState(initial?.orderNotes ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !mobileNumber.trim() || !deliveryLocation.trim()) {
      setError("Please fill in your name, mobile number, and delivery location.");
      return;
    }
    if (!acknowledged) {
      setError("Please acknowledge the delivery fee notice before continuing.");
      return;
    }
    setError(null);
    onContinue({ name: name.trim(), mobileNumber: mobileNumber.trim(), deliveryLocation: deliveryLocation.trim(), deliveryDirections: deliveryDirections.trim(), orderNotes: orderNotes.trim() });
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <h2 className="mb-4 text-lg font-semibold">Delivery Details</h2>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="customer-name">Name</Label>
          <Input id="customer-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="space-y-2">
          <Label htmlFor="customer-mobile">Mobile Number</Label>
          <Input id="customer-mobile" type="tel" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} placeholder="07XXXXXXXX" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="delivery-location">Deliver To</Label>
          <Input id="delivery-location" value={deliveryLocation} onChange={(e) => setDeliveryLocation(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="delivery-directions">Additional Directions (optional)</Label>
          <Input id="delivery-directions" value={deliveryDirections} onChange={(e) => setDeliveryDirections(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="order-notes">Order Notes (optional)</Label>
          <Input id="order-notes" value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <p className="text-xs font-medium">Delivery Fee</p>
          <p className="text-xs text-muted-foreground">{deliveryFeeNotice}</p>
          <div className="flex items-start gap-2 pt-1">
            <Checkbox id="delivery-fee-ack" checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} className="mt-0.5" />
            <Label htmlFor="delivery-fee-ack" className="text-xs font-normal">
              I understand the delivery fee is paid separately on delivery.
            </Label>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" className="w-full">
          Continue
        </Button>
      </form>
    </div>
  );
}
