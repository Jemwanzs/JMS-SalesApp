"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setQuantityEnabledAction } from "@/features/settings/actions/set-quantity-enabled";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function QuantityFieldCard({
  tenantId,
  tenantSlug,
  initialEnabled,
  locked = false,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
  /** Inventory Configuration -> Record Stock By is set to Quantity: the field is mandatory for tracked products, so this toggle is locked ON and can't be turned off here. */
  locked?: boolean;
}) {
  const [enabled, setEnabled] = useState(locked ? true : initialEnabled);
  const [isPending, startTransition] = useTransition();

  function onToggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const result = await setQuantityEnabledAction(tenantId, tenantSlug, next);
      if (result.error) {
        setEnabled(!next);
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quantity field</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="quantity-toggle" className="font-normal text-muted-foreground">
            Ask for a quantity when recording a sale. When off, only the sale amount is recorded.
          </Label>
          <Switch
            id="quantity-toggle"
            checked={enabled}
            disabled={isPending || locked}
            onCheckedChange={onToggle}
          />
        </div>
        {locked && (
          <p className="text-xs text-muted-foreground">
            Locked on because Inventory Configuration records stock by quantity -- switch that to Monetary Value to make this optional again.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
