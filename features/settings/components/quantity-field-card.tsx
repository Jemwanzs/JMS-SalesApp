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
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
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
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="quantity-toggle" className="font-normal text-muted-foreground">
            Ask for a quantity when recording a sale. When off, only the sale amount is recorded.
          </Label>
          <Switch
            id="quantity-toggle"
            checked={enabled}
            disabled={isPending}
            onCheckedChange={onToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
}
