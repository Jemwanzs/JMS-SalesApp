"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { daysUntil } from "@/lib/billing/status";
import type { SubscriptionView } from "@/services/BillingService";

/**
 * Trial/renewal alert banner (Product Enhancements #2) -- a compact,
 * non-intrusive strip surfacing the same subscription state
 * BillingStatusCard already shows on the dedicated /billing page.
 *
 * Product Enhancements (Subscription Due / Overdue Read-Only Mode):
 * `subscription` is only ever passed non-null for a Tenant Admin/the
 * billing owner (see the tenant layout's own isBillingAdmin check) --
 * an invited employee always renders `subscription: null` here, and
 * `if (!message) return null` below already handles that with zero
 * further changes needed in this component.
 *
 * Dismissible until the next calendar day (localStorage, keyed per
 * tenant+day so it reappears tomorrow with an updated day-count) --
 * except the SUSPENDED variant, which is never dismissible since real
 * write restrictions are already in effect at that point (has_permission
 * enforces that independently; this banner only surfaces the fact).
 * "Does not block normal usage unless the subscription has actually
 * expired" (the spec's own words) is exactly the SUSPENDED/else split
 * below.
 */
export function SubscriptionBanner({
  tenantId,
  tenantSlug,
  subscription,
}: {
  tenantId: string;
  tenantSlug: string;
  subscription: SubscriptionView | null;
}) {
  const [dismissed, setDismissed] = useState(false);

  const message = subscription ? getMessage(subscription) : null;
  const isSuspended = subscription?.status === "SUSPENDED";
  const isOverdue = subscription?.status === "PAYMENT_DUE" || subscription?.status === "GRACE_PERIOD" || isSuspended;
  const storageKey = message
    ? `subscription-banner-dismissed-${tenantId}-${new Date().toISOString().slice(0, 10)}`
    : null;

  useEffect(() => {
    if (!storageKey || isSuspended) return;
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // Private browsing / storage disabled -- fall back to always showing.
    }
  }, [storageKey, isSuspended]);

  if (!message || (dismissed && !isSuspended)) {
    return null;
  }

  function dismiss() {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Ignore -- worst case it shows again on the next page load.
    }
    setDismissed(true);
  }

  return (
    <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
      <p className="flex-1">{message}</p>
      <a
        href={`/t/${tenantSlug}/billing`}
        className="shrink-0 rounded-md bg-amber-500/20 px-2 py-1 font-medium hover:bg-amber-500/30"
      >
        {isOverdue ? "Renew Subscription" : "Manage subscription"}
      </a>
      {!isSuspended && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="shrink-0 text-amber-900/60 hover:text-amber-900 dark:text-amber-200/60 dark:hover:text-amber-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function getMessage(subscription: SubscriptionView): string | null {
  if (subscription.status === "TRIAL") {
    const n = daysUntil(subscription.trialEnd);
    if (n == null) return null;
    return n > 0 ? `You have ${n} day${n === 1 ? "" : "s"} remaining on your free trial.` : "Your free trial has ended.";
  }

  if (subscription.status === "ACTIVE") {
    const n = daysUntil(subscription.currentPeriodEnd);
    if (n == null || n > 3) return null;
    if (n > 1) return `Your subscription renews in ${n} days.`;
    if (n === 1) return "Your subscription renews in 1 day.";
    return "Your subscription renews today.";
  }

  if (subscription.status === "PAYMENT_DUE" || subscription.status === "GRACE_PERIOD") {
    return "Subscription Payment Due — your subscription is due. You have a 3-hour grace period to renew and continue using all application features.";
  }

  if (subscription.status === "SUSPENDED") {
    return "Subscription Overdue — Read-Only Mode. Your 3-hour grace period has expired. Your data remains safely accessible, but changes and new transactions have been temporarily disabled. Renew your subscription to restore full access.";
  }

  return null;
}
