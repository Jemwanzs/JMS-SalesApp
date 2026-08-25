"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setInventoryEnabledAction } from "@/features/settings/actions/set-inventory-enabled";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Settings -> Modules toggle (Product Enhancements #3), same shape as
 * QuantityFieldCard (optimistic Switch, useTransition, toast) except
 * flipping ON opens a confirmation Dialog first, since -- unlike every
 * other setting on this page -- this one can have a real billing
 * consequence. The actual branching (trial vs already-entitled vs real
 * checkout) all happens server-side in setInventoryEnabledAction; this
 * component only decides whether to redirect when the action hands back
 * a checkoutUrl.
 */
export function InventoryModuleCard({
  tenantId,
  tenantSlug,
  initialEnabled,
  planPrice,
  planCurrency,
  planDurationDays,
  trialDaysAvailable,
  /** Precomputed server-side (same branch order as setInventoryEnabledAction) so the confirmation copy never promises a free trial that the server action won't actually grant -- e.g. a tenant re-enabling after a lapsed/cancelled subscription always sees checkout copy, not trial copy, even though a trial IS configured globally. */
  confirmMode,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
  planPrice: number;
  planCurrency: string;
  planDurationDays: number;
  trialDaysAvailable: number;
  confirmMode: "reenable" | "trial" | "checkout";
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function turnOff() {
    setEnabled(false);
    startTransition(async () => {
      const result = await setInventoryEnabledAction(tenantId, tenantSlug, false);
      if (result.error) {
        setEnabled(true);
        toast.error(result.error);
        return;
      }
      toast.success("Inventory Management turned off");
    });
  }

  function confirmTurnOn() {
    startTransition(async () => {
      const result = await setInventoryEnabledAction(tenantId, tenantSlug, true);
      if (result.error) {
        toast.error(result.error);
        setConfirmOpen(false);
        return;
      }
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      setEnabled(true);
      setConfirmOpen(false);
      toast.success("Inventory Management is on");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modules</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="inventory-toggle" className="font-normal text-muted-foreground">
            Inventory Management — track stock, receive/issue quantities, and daily reconciliation for your products.
          </Label>
          <Switch
            id="inventory-toggle"
            checked={enabled}
            disabled={isPending}
            onCheckedChange={(next) => (next ? setConfirmOpen(true) : turnOff())}
          />
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enable Inventory Management?</DialogTitle>
                <DialogDescription>
                  {confirmMode === "reenable" &&
                    `Turns the "Stock" tab back on. Your subscription is already active, so there's nothing to pay right now.`}
                  {confirmMode === "trial" &&
                    `Start a ${trialDaysAvailable}-day free trial. After that, ${planCurrency} ${planPrice.toFixed(2)} every ${planDurationDays} days.`}
                  {confirmMode === "checkout" &&
                    `${planCurrency} ${planPrice.toFixed(2)} every ${planDurationDays} days. This adds a "Stock" tab for tracking quantities alongside your existing product catalog.`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button onClick={confirmTurnOn} disabled={isPending}>
                  {isPending
                    ? "Please wait..."
                    : confirmMode === "reenable"
                      ? "Turn on"
                      : confirmMode === "trial"
                        ? "Start free trial"
                        : `Subscribe — pay ${planCurrency} ${planPrice.toFixed(2)}`}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
