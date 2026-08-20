"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Sparkles, TrendingUp } from "lucide-react";
import { toast } from "sonner";

import { startCheckoutAction } from "@/features/billing/actions/start-checkout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { PlanView } from "@/services/BillingService";

/**
 * The picker itself decides nothing about price -- whichever plan the
 * user selects here is passed straight through to startCheckoutAction
 * -> BillingService.initializeCheckout, which reads that SAME plan row
 * fresh from the database for the actual Paystack amount. The card
 * just displays what's already true; it can't diverge from what gets
 * charged.
 */
export function PlanPickerDialog({
  tenantId,
  tenantSlug,
  plans,
  triggerLabel,
}: {
  tenantId: string;
  tenantSlug: string;
  plans: PlanView[];
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const bestValuePlanId = useMemo(() => {
    if (plans.length === 0) return null;
    return plans.reduce((best, p) => (p.price / p.durationDays < best.price / best.durationDays ? p : best)).id;
  }, [plans]);

  const popularPlanId = useMemo(() => plans.find((p) => p.durationDays === 30)?.id ?? null, [plans]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  function onConfirm() {
    if (!selectedPlanId) return;
    startTransition(async () => {
      const result = await startCheckoutAction(tenantId, tenantSlug, selectedPlanId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.activatedDirectly) {
        // A credit fully covered this plan -- no Paystack redirect
        // happened, the subscription is already ACTIVE server-side.
        toast.success("Your credit covered this plan in full -- you're all set!");
        setOpen(false);
        setSelectedPlanId(null);
        return;
      }
      if (result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelectedPlanId(null);
      }}
    >
      <DialogTrigger render={<Button />}>{triggerLabel}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose your plan</DialogTitle>
          <DialogDescription>Pick the access period that works for you. You&rsquo;re only charged once you confirm.</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] grid-cols-1 gap-3 overflow-y-auto p-1 sm:grid-cols-2">
          {plans.map((plan) => {
            const perDay = plan.price / plan.durationDays;
            const selected = selectedPlanId === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlanId(plan.id)}
                className={cn(
                  "relative flex flex-col gap-1 rounded-xl border p-4 text-left transition-all",
                  selected
                    ? "border-primary bg-primary/5 shadow-sm ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50 hover:bg-muted/50"
                )}
              >
                {selected && (
                  <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-semibold">{plan.name}</p>
                  {plan.id === bestValuePlanId && (
                    <Badge variant="default" className="gap-1">
                      <TrendingUp className="h-3 w-3" /> Best Value
                    </Badge>
                  )}
                  {plan.id === popularPlanId && plan.id !== bestValuePlanId && (
                    <Badge variant="secondary" className="gap-1">
                      <Sparkles className="h-3 w-3" /> Popular
                    </Badge>
                  )}
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {plan.currency} {plan.price.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {plan.durationDays} day{plan.durationDays === 1 ? "" : "s"} access · ≈ {plan.currency} {perDay.toFixed(0)}/day
                </p>
              </button>
            );
          })}
        </div>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {selectedPlan ? (
              <>
                Selected: <span className="font-medium text-foreground">{selectedPlan.name}</span> — {selectedPlan.currency}{" "}
                {selectedPlan.price.toLocaleString()}
              </>
            ) : (
              "Select a plan to continue"
            )}
          </p>
          <Button onClick={onConfirm} disabled={!selectedPlanId || isPending}>
            {isPending ? "Redirecting to payment..." : "Continue to Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
