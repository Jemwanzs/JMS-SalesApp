"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setExpensesEnabledAction } from "@/features/settings/actions/set-expenses-enabled";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * A plain instant toggle, not the confirmation-dialog/billing-branch
 * pattern InventoryModuleCard uses -- Daily Expenses carries no billing
 * dimension at all (spec: "no additional billing for enabling this
 * feature"), so there's no trial/checkout/reactivation state to confirm
 * before flipping it on. Same shape as QuantityFieldCard/NotesFieldCard.
 */
export function ExpensesModuleCard({
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
      const result = await setExpensesEnabledAction(tenantId, tenantSlug, next);
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
        <CardTitle>Daily Expenses</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="expenses-toggle" className="font-normal text-muted-foreground">
            Track operational expenses (water, electricity, rent, transport, and more) separately from stock purchases. No additional cost to enable.
          </Label>
          <Switch
            id="expenses-toggle"
            checked={enabled}
            disabled={isPending}
            onCheckedChange={onToggle}
          />
        </div>
      </CardContent>
    </Card>
  );
}
