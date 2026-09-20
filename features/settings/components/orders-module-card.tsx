"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOrdersEnabledAction } from "@/features/settings/actions/set-orders-enabled";
import { setPublicOrderingEnabledAction } from "@/features/settings/actions/set-public-ordering-enabled";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Both Orders Module and Public Ordering live in ONE card, not two
 * separate page-level conditional ones -- confirmed live that the
 * two-card split doesn't actually work for an instant-toggle pattern:
 * flipping Orders Module here only updates ITS OWN local React state,
 * and a page-level `{ordersEnabled && <PublicOrderingCard/>}` in
 * settings/page.tsx reads the value settings/page.tsx fetched at the
 * START of this request -- router.refresh() does trigger a real RSC
 * re-fetch (confirmed via network trace) but the newly-eligible
 * PublicOrderingCard still didn't mount in testing. Following
 * SaleDateSelectionCard's own established "one card, local state
 * governs a conditional sub-section" shape instead sidesteps this
 * entirely: Public Ordering's visibility is a client-side decision the
 * moment Orders Module's own switch flips, no server round trip needed
 * for the UI to react correctly. Each switch still calls its own
 * server action instantly (not deferred to a shared Save button) --
 * matching every other module toggle's own instant-save UX.
 */
export function OrdersModuleCard({
  tenantId,
  tenantSlug,
  initialOrdersEnabled,
  initialPublicOrderingEnabled,
}: {
  tenantId: string;
  tenantSlug: string;
  initialOrdersEnabled: boolean;
  initialPublicOrderingEnabled: boolean;
}) {
  const [ordersEnabled, setOrdersEnabled] = useState(initialOrdersEnabled);
  const [publicOrderingEnabled, setPublicOrderingEnabled] = useState(initialPublicOrderingEnabled);
  const [isPending, startTransition] = useTransition();

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
        )}
      </CardContent>
    </Card>
  );
}
