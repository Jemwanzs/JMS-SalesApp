"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setWhatsAppMessagesAction } from "@/features/settings/actions/set-whatsapp-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const TEXTAREA_CLASSNAME =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

const PLACEHOLDER_HINT = "Available: {customerName} {orderNumber} {outletName} {orderTotal} {deliveryLocation}";

/**
 * The two order-status WhatsApp prefill templates the spec explicitly
 * calls out as worth customizing (sections 2 and 16) -- its own card
 * rather than folded into OrdersModuleCard's storefront-content form,
 * since these are staff-tool prefill text, not public storefront copy
 * (same "new card for a genuinely distinct concern" call Phase 3a's
 * ReceiptSettingsCard already made).
 */
export function WhatsAppMessagesCard({
  tenantId,
  tenantSlug,
  initialOnDeliveryTemplate,
  initialCompletedTemplate,
}: {
  tenantId: string;
  tenantSlug: string;
  initialOnDeliveryTemplate: string | null;
  initialCompletedTemplate: string | null;
}) {
  const [onDeliveryTemplate, setOnDeliveryTemplate] = useState(initialOnDeliveryTemplate ?? "");
  const [completedTemplate, setCompletedTemplate] = useState(initialCompletedTemplate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("whatsappMessageOnDelivery", onDeliveryTemplate);
    formData.set("whatsappMessageCompleted", completedTemplate);

    startTransition(async () => {
      const result = await setWhatsAppMessagesAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp Messages</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Prefilled text for the WhatsApp icon on orders. Staff always review and send it manually -- nothing here is sent automatically.
          </p>

          <div className="space-y-1">
            <Label htmlFor="whatsapp-message-on-delivery" className="text-xs text-muted-foreground">
              On Delivery Message
            </Label>
            <textarea
              id="whatsapp-message-on-delivery"
              rows={3}
              className={TEXTAREA_CLASSNAME}
              value={onDeliveryTemplate}
              onChange={(e) => setOnDeliveryTemplate(e.target.value)}
              disabled={isPending}
              placeholder="Defaults to a standard on-delivery message"
            />
            <p className="text-[11px] text-muted-foreground">{PLACEHOLDER_HINT}</p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="whatsapp-message-completed" className="text-xs text-muted-foreground">
              Order Completed Message
            </Label>
            <textarea
              id="whatsapp-message-completed"
              rows={3}
              className={TEXTAREA_CLASSNAME}
              value={completedTemplate}
              onChange={(e) => setCompletedTemplate(e.target.value)}
              disabled={isPending}
              placeholder="Defaults to a standard thank-you message"
            />
            <p className="text-[11px] text-muted-foreground">{PLACEHOLDER_HINT}</p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
