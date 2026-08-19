import { PlanPickerDialog } from "@/features/billing/components/plan-picker-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlanView, SubscriptionView } from "@/services/BillingService";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  TRIAL: "secondary",
  ACTIVE: "default",
  PAYMENT_DUE: "destructive",
  GRACE_PERIOD: "destructive",
  SUSPENDED: "destructive",
  CANCELLED: "secondary",
};

const STATUS_LABEL: Record<string, string> = {
  TRIAL: "Free trial",
  ACTIVE: "Active",
  PAYMENT_DUE: "Payment due",
  GRACE_PERIOD: "Grace period",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function BillingStatusCard({
  tenantId,
  tenantSlug,
  subscription,
  plans,
  canPay,
}: {
  tenantId: string;
  tenantSlug: string;
  subscription: SubscriptionView;
  plans: PlanView[];
  canPay: boolean;
}) {
  const needsPayment =
    subscription.status === "TRIAL" ||
    subscription.status === "PAYMENT_DUE" ||
    subscription.status === "GRACE_PERIOD" ||
    subscription.status === "SUSPENDED";

  const trialDaysLeft = subscription.status === "TRIAL" ? daysUntil(subscription.trialEnd) : null;
  const graceDaysLeft = subscription.status === "GRACE_PERIOD" ? daysUntil(subscription.gracePeriodEnd) : null;

  const triggerLabel = subscription.status === "ACTIVE" ? "Renew / Change Plan" : "Choose a Plan";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {subscription.planName ?? "No plan yet"}
          <Badge variant={STATUS_VARIANT[subscription.status] ?? "secondary"}>
            {STATUS_LABEL[subscription.status] ?? subscription.status}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {subscription.planPrice != null && subscription.planCurrency && (
          <p className="text-sm text-muted-foreground">
            {subscription.planCurrency} {subscription.planPrice.toFixed(2)}
          </p>
        )}

        {trialDaysLeft != null && (
          <p className="text-sm">
            {trialDaysLeft > 0 ? `${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left in your free trial.` : "Your free trial has ended."}
          </p>
        )}
        {graceDaysLeft != null && (
          <p className="text-sm text-destructive">
            {graceDaysLeft > 0
              ? `Payment is overdue -- ${graceDaysLeft} day${graceDaysLeft === 1 ? "" : "s"} left before this workspace is suspended.`
              : "This workspace will be suspended shortly."}
          </p>
        )}
        {subscription.status === "SUSPENDED" && (
          <p className="text-sm text-destructive">
            This workspace is suspended. Pay now to restore full access -- your historical data is safe and untouched.
          </p>
        )}
        {subscription.status === "ACTIVE" && subscription.nextBillingDate && (
          <p className="text-sm text-muted-foreground">
            Access ends: {new Date(subscription.nextBillingDate).toLocaleDateString()}
          </p>
        )}

        {needsPayment && canPay && <PlanPickerDialog tenantId={tenantId} tenantSlug={tenantSlug} plans={plans} triggerLabel={triggerLabel} />}
        {needsPayment && !canPay && (
          <p className="text-xs text-muted-foreground">Only the billing owner can make a payment for this workspace.</p>
        )}
      </CardContent>
    </Card>
  );
}
