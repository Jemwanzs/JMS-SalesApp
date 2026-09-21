"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink } from "lucide-react";

import { setCustomerOrdersContentAction } from "@/features/settings/actions/set-customer-orders-content";
import { setOrdersEnabledAction } from "@/features/settings/actions/set-orders-enabled";
import { setPublicOrderingEnabledAction } from "@/features/settings/actions/set-public-ordering-enabled";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Everything Customer Orders needs from Settings lives in ONE card --
 * Orders Module + Public Ordering toggles, the storefront's content
 * strings, and the shareable Ordering Link -- rather than splitting
 * across several page-level-conditional cards. Confirmed live in
 * Phase 2a that a page-level `{ordersEnabled && <SomeCard/>}` split
 * doesn't give instant same-page reactivity when a sibling toggle
 * flips (router.refresh() fires a correct RSC re-fetch but the newly-
 * eligible sibling still doesn't mount) -- one component with local
 * state sidesteps that entirely, same fix already applied once this
 * session (see that commit's own note, and SaleDateSelectionCard's
 * original precedent for this shape).
 */
export function OrdersModuleCard({
  tenantId,
  tenantSlug,
  initialOrdersEnabled,
  initialPublicOrderingEnabled,
  initialOrderOutletName,
  initialWelcomeMessage,
  initialDeliveryFeeNotice,
  initialCompletionMessage,
}: {
  tenantId: string;
  tenantSlug: string;
  initialOrdersEnabled: boolean;
  initialPublicOrderingEnabled: boolean;
  initialOrderOutletName: string | null;
  initialWelcomeMessage: string | null;
  initialDeliveryFeeNotice: string | null;
  initialCompletionMessage: string | null;
}) {
  const [ordersEnabled, setOrdersEnabled] = useState(initialOrdersEnabled);
  const [publicOrderingEnabled, setPublicOrderingEnabled] = useState(initialPublicOrderingEnabled);
  const [isPending, startTransition] = useTransition();

  const [outletName, setOutletName] = useState(initialOrderOutletName ?? "");
  const [welcomeMessage, setWelcomeMessage] = useState(initialWelcomeMessage ?? "");
  const [deliveryFeeNotice, setDeliveryFeeNotice] = useState(initialDeliveryFeeNotice ?? "");
  const [completionMessage, setCompletionMessage] = useState(initialCompletionMessage ?? "");
  const [contentError, setContentError] = useState<string | null>(null);
  const [isContentPending, startContentTransition] = useTransition();

  const [copied, setCopied] = useState(false);
  const orderingLink = typeof window !== "undefined" ? `${window.location.origin}/order/${tenantSlug}` : `/order/${tenantSlug}`;

  function onToggleOrders(next: boolean) {
    setOrdersEnabled(next);
    startTransition(async () => {
      const result = await setOrdersEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setOrdersEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  function onTogglePublicOrdering(next: boolean) {
    setPublicOrderingEnabled(next);
    startTransition(async () => {
      const result = await setPublicOrderingEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setPublicOrderingEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  function onSaveContent(e: React.FormEvent) {
    e.preventDefault();
    setContentError(null);
    const formData = new FormData();
    formData.set("orderOutletName", outletName);
    formData.set("orderWelcomeMessage", welcomeMessage);
    formData.set("orderDeliveryFeeNotice", deliveryFeeNotice);
    formData.set("orderCompletionMessage", completionMessage);
    startContentTransition(async () => {
      const result = await setCustomerOrdersContentAction(tenantId, tenantSlug, {}, formData);
      if (result.error) {
        setContentError(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  async function onCopyLink() {
    try {
      await navigator.clipboard.writeText(orderingLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the link");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders Module</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="orders-toggle" className="font-normal text-muted-foreground">
            Let customers place orders directly with you. Adds an Orders section for authorized staff -- separate from Sales.
          </Label>
          <Switch id="orders-toggle" checked={ordersEnabled} disabled={isPending} onCheckedChange={onToggleOrders} />
        </div>

        {ordersEnabled && (
          <>
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="public-ordering-toggle" className="font-normal text-muted-foreground">
                  Activate your public ordering page so customers can start placing orders. Existing order data is preserved when this is off.
                </Label>
                <Switch
                  id="public-ordering-toggle"
                  checked={publicOrderingEnabled}
                  disabled={isPending}
                  onCheckedChange={onTogglePublicOrdering}
                />
              </div>
            </div>

            <div className="space-y-2 border-t pt-4">
              <Label>Customer Ordering Link</Label>
              <p className="break-all rounded-lg bg-muted p-2 text-xs">{orderingLink}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCopyLink}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy Link"}
                </Button>
                <a href={orderingLink} target="_blank" rel="noopener noreferrer">
                  <Button type="button" variant="outline" size="sm">
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </Button>
                </a>
              </div>
              {!publicOrderingEnabled && (
                <p className="text-xs text-muted-foreground">
                  Customers can&apos;t place orders here yet -- turn on Public Ordering above first.
                </p>
              )}
            </div>

            <form onSubmit={onSaveContent} className="space-y-3 border-t pt-4">
              <Label>Storefront content</Label>
              <div className="space-y-1">
                <Label htmlFor="order-outlet-name" className="text-xs text-muted-foreground">
                  Order Outlet Name
                </Label>
                <Input
                  id="order-outlet-name"
                  value={outletName}
                  onChange={(e) => setOutletName(e.target.value)}
                  placeholder="Defaults to your business name"
                  disabled={isContentPending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="order-welcome-message" className="text-xs text-muted-foreground">
                  Customer Welcome Message
                </Label>
                <Input
                  id="order-welcome-message"
                  value={welcomeMessage}
                  onChange={(e) => setWelcomeMessage(e.target.value)}
                  placeholder="Optional"
                  disabled={isContentPending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="order-delivery-fee-notice" className="text-xs text-muted-foreground">
                  Delivery Fee Notice
                </Label>
                <Input
                  id="order-delivery-fee-notice"
                  value={deliveryFeeNotice}
                  onChange={(e) => setDeliveryFeeNotice(e.target.value)}
                  placeholder="Defaults to a standard delivery fee notice"
                  disabled={isContentPending}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="order-completion-message" className="text-xs text-muted-foreground">
                  Order Completion Message
                </Label>
                <Input
                  id="order-completion-message"
                  value={completionMessage}
                  onChange={(e) => setCompletionMessage(e.target.value)}
                  placeholder="Defaults to a standard thank-you message"
                  disabled={isContentPending}
                />
              </div>
              {contentError && <p className="text-xs text-destructive">{contentError}</p>}
              <Button type="submit" size="sm" disabled={isContentPending}>
                {isContentPending ? "Saving..." : "Save"}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}
