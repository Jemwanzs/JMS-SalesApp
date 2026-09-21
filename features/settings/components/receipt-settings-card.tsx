"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOrderReceiptSettingsAction } from "@/features/settings/actions/set-order-receipt-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const DEFAULT_BACKGROUND_COLOR = "#0F7A3D";
const DEFAULT_TEXT_COLOR = "#FFFFFF";

const TEXTAREA_CLASSNAME =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/**
 * Branding config for the POS-style order receipt (spec section 10) --
 * its own card rather than folded into OrdersModuleCard, since nothing
 * here needs same-page reactivity with anything else on the Settings
 * page (unlike the Orders Module + Public Ordering toggle pair). One
 * form, one Save, same shape as OrdersModuleCard's own content-fields
 * half.
 */
export function ReceiptSettingsCard({
  tenantId,
  tenantSlug,
  initialShowLogo,
  initialWidth,
  initialBackgroundColor,
  initialTextColor,
  initialShowCustomerMobile,
  initialShowDeliveryPerson,
  initialFooterMessage,
}: {
  tenantId: string;
  tenantSlug: string;
  initialShowLogo: boolean;
  initialWidth: string | null;
  initialBackgroundColor: string | null;
  initialTextColor: string | null;
  initialShowCustomerMobile: boolean;
  initialShowDeliveryPerson: boolean;
  initialFooterMessage: string | null;
}) {
  const [showLogo, setShowLogo] = useState(initialShowLogo);
  const [width, setWidth] = useState(initialWidth ?? "80mm");
  const [backgroundColor, setBackgroundColor] = useState(initialBackgroundColor ?? DEFAULT_BACKGROUND_COLOR);
  const [textColor, setTextColor] = useState(initialTextColor ?? DEFAULT_TEXT_COLOR);
  const [showCustomerMobile, setShowCustomerMobile] = useState(initialShowCustomerMobile);
  const [showDeliveryPerson, setShowDeliveryPerson] = useState(initialShowDeliveryPerson);
  const [footerMessage, setFooterMessage] = useState(initialFooterMessage ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const formData = new FormData();
    formData.set("receiptShowLogo", String(showLogo));
    formData.set("receiptWidth", width);
    formData.set("receiptBackgroundColor", backgroundColor);
    formData.set("receiptTextColor", textColor);
    formData.set("receiptShowCustomerMobile", String(showCustomerMobile));
    formData.set("receiptShowDeliveryPerson", String(showDeliveryPerson));
    formData.set("receiptFooterMessage", footerMessage);

    startTransition(async () => {
      const result = await setOrderReceiptSettingsAction(tenantId, tenantSlug, {}, formData);
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
        <CardTitle>Order Receipt</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSave} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="receipt-show-logo" className="font-normal text-muted-foreground">
              Show your logo on the receipt
            </Label>
            <Switch id="receipt-show-logo" checked={showLogo} disabled={isPending} onCheckedChange={setShowLogo} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="receipt-width" className="text-xs text-muted-foreground">
              Receipt Width
            </Label>
            <select
              id="receipt-width"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              disabled={isPending}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none"
            >
              <option value="80mm">80mm (recommended)</option>
              <option value="58mm">58mm</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="receipt-bg-color" className="text-xs text-muted-foreground">
                Background Color
              </Label>
              <div className="flex items-center gap-2">
                <input
                  id="receipt-bg-color"
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  disabled={isPending}
                  className="h-9 w-9 shrink-0 rounded border border-input bg-transparent p-0.5"
                />
                <Input value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} disabled={isPending} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="receipt-text-color" className="text-xs text-muted-foreground">
                Text Color
              </Label>
              <div className="flex items-center gap-2">
                <input
                  id="receipt-text-color"
                  type="color"
                  value={textColor}
                  onChange={(e) => setTextColor(e.target.value)}
                  disabled={isPending}
                  className="h-9 w-9 shrink-0 rounded border border-input bg-transparent p-0.5"
                />
                <Input value={textColor} onChange={(e) => setTextColor(e.target.value)} disabled={isPending} />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="receipt-show-mobile" className="font-normal text-muted-foreground">
              Show customer mobile number
            </Label>
            <Switch id="receipt-show-mobile" checked={showCustomerMobile} disabled={isPending} onCheckedChange={setShowCustomerMobile} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="receipt-show-delivery-person" className="font-normal text-muted-foreground">
              Show delivery person details
            </Label>
            <Switch
              id="receipt-show-delivery-person"
              checked={showDeliveryPerson}
              disabled={isPending}
              onCheckedChange={setShowDeliveryPerson}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="receipt-footer-message" className="text-xs text-muted-foreground">
              Footer Message
            </Label>
            <textarea
              id="receipt-footer-message"
              rows={2}
              className={TEXTAREA_CLASSNAME}
              value={footerMessage}
              onChange={(e) => setFooterMessage(e.target.value)}
              disabled={isPending}
              placeholder="Defaults to your order completion message, or a standard thank-you"
            />
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
