"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { setInventoryEnabledAction } from "@/features/settings/actions/set-inventory-enabled";
import { formatTrialLength } from "@/lib/inventory/trial-copy";
import { cn } from "@/lib/utils";
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
import type { AddonPlanView } from "@/services/BillingService";

/**
 * Settings -> Modules toggle (Product Enhancements #3), same shape as
 * QuantityFieldCard (optimistic Switch, useTransition, toast) except
 * flipping ON opens a confirmation Dialog first, since -- unlike every
 * other setting on this page -- this one can have a real billing
 * consequence. The actual branching (trial vs already-entitled vs real
 * checkout) all happens server-side in setInventoryEnabledAction; this
 * component only decides whether to redirect when the action hands back
 * a checkoutUrl, and (checkout mode only) which of the active duration
 * tiers the tenant wants to pay for.
 *
 * On a real success (trial started, re-enabled, or credit-activated --
 * anything that doesn't redirect to Paystack), the same dialog swaps to
 * a success state showing the server-computed message -- the tenant
 * stays right here on Settings (an earlier version auto-navigated into
 * Stock after a short pause; reverted after feedback: enabling the
 * module should just light up the Stock tab in the bottom nav, not pull
 * the admin away from whatever else they were configuring).
 * router.refresh() re-fetches the tenant layout (which computes
 * inventoryEnabled for the bottom nav) so that tab appears immediately
 * without an actual navigation.
 */
export function InventoryModuleCard({
  tenantId,
  tenantSlug,
  initialEnabled,
  plans,
  trialDaysAvailable,
  /** Precomputed server-side (same branch order as setInventoryEnabledAction) so the confirmation copy never promises a free trial that the server action won't actually grant -- e.g. a tenant re-enabling after a lapsed/cancelled subscription always sees checkout copy, not trial copy, even though a trial IS configured globally. */
  confirmMode,
}: {
  tenantId: string;
  tenantSlug: string;
  initialEnabled: boolean;
  /** Active plans only, ordered by duration_days ascending (BillingService.listAddonPlans) -- one tile per duration tier in checkout mode. */
  plans: AddonPlanView[];
  trialDaysAvailable: number;
  confirmMode: "reenable" | "trial" | "checkout";
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(plans[0]?.id ?? null);
  const [isPending, startTransition] = useTransition();

  const cheapestPlan = useMemo(
    () => plans.reduce((min, p) => (p.price < min.price ? p : min), plans[0]),
    [plans]
  );
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? plans[0];

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
      const result = await setInventoryEnabledAction(tenantId, tenantSlug, true, selectedPlan?.id);
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
      setSuccessMessage(result.successMessage ?? "Inventory Management is on.");
      router.refresh();
    });
  }

  function onDialogOpenChange(open: boolean) {
    setConfirmOpen(open);
    if (!open) {
      // Closing after a success (or the user backing out of it) --
      // clear so the NEXT open always starts from the confirm step.
      setSuccessMessage(null);
    }
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
          <Dialog open={confirmOpen} onOpenChange={onDialogOpenChange}>
            <DialogContent>
              {successMessage ? (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      You&apos;re all set
                    </DialogTitle>
                    <DialogDescription>{successMessage} The Stock tab is now available in your navigation.</DialogDescription>
                  </DialogHeader>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Enable Inventory Management?</DialogTitle>
                    <DialogDescription>
                      {confirmMode === "reenable" &&
                        `Turns the "Stock" tab back on. Your subscription is already active, so there's nothing to pay right now.`}
                      {confirmMode === "trial" &&
                        `Start a free ${formatTrialLength(trialDaysAvailable)} trial. Afterwards, plans start from ${cheapestPlan.currency} ${cheapestPlan.price.toFixed(0)} — pick one anytime.`}
                      {confirmMode === "checkout" && "Choose a plan to add a \"Stock\" tab for tracking quantities alongside your existing product catalog."}
                    </DialogDescription>
                  </DialogHeader>

                  {confirmMode === "checkout" && (
                    <div className="space-y-2">
                      {plans.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSelectedPlanId(plan.id)}
                          disabled={isPending}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                            plan.id === selectedPlan?.id
                              ? "border-primary bg-primary/5"
                              : "border-input hover:bg-muted/50"
                          )}
                        >
                          <span className="font-medium">{plan.name}</span>
                          <span className="text-muted-foreground">
                            {plan.currency} {plan.price.toFixed(0)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={isPending}>
                      Cancel
                    </Button>
                    <Button onClick={confirmTurnOn} disabled={isPending || (confirmMode === "checkout" && !selectedPlan)}>
                      {isPending
                        ? "Please wait..."
                        : confirmMode === "reenable"
                          ? "Turn on"
                          : confirmMode === "trial"
                            ? "Start free trial"
                            : `Subscribe — pay ${selectedPlan?.currency ?? ""} ${selectedPlan?.price.toFixed(0) ?? ""}`}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
