import type { SubscriptionStatus } from "@/types/database.types";

/**
 * Shared subscription-status vocabulary -- previously duplicated inline
 * in BillingStatusCard, now also consumed by SubscriptionBanner (Product
 * Enhancements #2) so both read the exact same day-count/label logic.
 */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export const STATUS_VARIANT: Record<SubscriptionStatus, "default" | "secondary" | "destructive"> = {
  TRIAL: "secondary",
  ACTIVE: "default",
  PAYMENT_DUE: "destructive",
  GRACE_PERIOD: "destructive",
  SUSPENDED: "destructive",
  CANCELLED: "secondary",
};

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  TRIAL: "Free trial",
  ACTIVE: "Active",
  PAYMENT_DUE: "Payment due",
  GRACE_PERIOD: "Grace period",
  SUSPENDED: "Suspended",
  CANCELLED: "Cancelled",
};
