"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cancelOrderAction } from "@/features/orders/actions/cancel-order";
import { completeOrderAction } from "@/features/orders/actions/complete-order";
import { markOrderOnDeliveryAction } from "@/features/orders/actions/mark-on-delivery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrderStatus } from "@/types/database.types";

const TEXTAREA_CLASSNAME =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * Renders the one contextually-correct next action for the order's
 * current status -- never more than one at a time, matching the spec's
 * own linear received -> being_attended -> on_delivery -> completed
 * workflow. Cancel is offered alongside the primary action for any of
 * the three active states. Each form is only shown if the viewer holds
 * the matching permission (orders.mark_on_delivery / orders.complete /
 * orders.cancel) -- being_attended's own transition has no button at
 * all, it already happened automatically when this page loaded.
 */
export function OrderActionPanel({
  tenantSlug,
  tenantId,
  orderId,
  status,
  canMarkOnDelivery,
  canComplete,
  canCancel,
}: {
  tenantSlug: string;
  tenantId: string;
  orderId: string;
  status: OrderStatus;
  canMarkOnDelivery: boolean;
  canComplete: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [deliveryPersonName, setDeliveryPersonName] = useState("");
  const [deliveryPersonMobile, setDeliveryPersonMobile] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");

  function submitMarkOnDelivery(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("orderId", orderId);
    formData.set("deliveryPersonName", deliveryPersonName);
    formData.set("deliveryPersonMobile", deliveryPersonMobile);
    formData.set("deliveryNotes", deliveryNotes);

    startTransition(async () => {
      const result = await markOrderOnDeliveryAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Order marked as on delivery");
      router.refresh();
    });
  }

  function submitComplete() {
    setError(null);
    startTransition(async () => {
      const result = await completeOrderAction(tenantId, tenantSlug, orderId);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Order completed");
      router.refresh();
    });
  }

  function submitCancel(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("orderId", orderId);
    formData.set("reason", cancelReason);

    startTransition(async () => {
      const result = await cancelOrderAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Check the fields above");
        return;
      }
      toast.success("Order cancelled");
      router.refresh();
    });
  }

  const isActive = status === "received" || status === "being_attended" || status === "on_delivery";
  if (!isActive) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {status === "being_attended" && canMarkOnDelivery && !showCancelForm && (
        <form onSubmit={submitMarkOnDelivery} className="space-y-3">
          <p className="text-sm font-medium">Mark as on delivery</p>
          <div className="space-y-2">
            <Label htmlFor="delivery-person-name">Delivery person name</Label>
            <Input id="delivery-person-name" value={deliveryPersonName} onChange={(e) => setDeliveryPersonName(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-person-mobile">Delivery person mobile number</Label>
            <Input id="delivery-person-mobile" value={deliveryPersonMobile} onChange={(e) => setDeliveryPersonMobile(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delivery-notes">Notes (optional)</Label>
            <textarea id="delivery-notes" rows={2} className={TEXTAREA_CLASSNAME} value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} />
          </div>
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Saving..." : "Mark on delivery"}
          </Button>
        </form>
      )}

      {status === "on_delivery" && canComplete && !showCancelForm && (
        <div className="space-y-3">
          <p className="text-sm font-medium">This order is out for delivery.</p>
          <Button type="button" onClick={submitComplete} disabled={isPending} className="w-full">
            {isPending ? "Saving..." : "Mark as completed"}
          </Button>
        </div>
      )}

      {status === "received" && !canMarkOnDelivery && !canComplete && !canCancel && (
        <p className="text-sm text-muted-foreground">Waiting to be attended.</p>
      )}

      {canCancel && (
        <div className="space-y-3 border-t pt-4">
          {!showCancelForm ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowCancelForm(true)} disabled={isPending}>
              Cancel this order
            </Button>
          ) : (
            <form onSubmit={submitCancel} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="cancel-reason">Reason for cancelling</Label>
                <textarea
                  id="cancel-reason"
                  rows={2}
                  className={TEXTAREA_CLASSNAME}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
                  {isPending ? "Cancelling..." : "Confirm cancel"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setShowCancelForm(false)} disabled={isPending}>
                  Back
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
