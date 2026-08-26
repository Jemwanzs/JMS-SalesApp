import type { Metadata } from "next";
import { BackLink } from "@/components/shared/back-link";
import { redirect } from "next/navigation";

import { BillingStatusCard } from "@/features/billing/components/billing-status-card";
import { PaymentHistoryList } from "@/features/billing/components/payment-history-list";
import { BillingService } from "@/services/BillingService";
import { can } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getTenantBySlug } from "@/lib/tenant/resolve-tenant-by-slug";

export const metadata: Metadata = {
  title: "Billing | JMS Sales App",
};

/**
 * Phase 6: the billing owner UI (docs/14-billing-paystack.md). Access
 * is `tenants.billing_owner_profile_id === auth.uid()` OR settings.
 * manage -- the two-clause check that naturally reduces to "billing
 * owner only" once a tenant is SUSPENDED, since settings.manage isn't
 * is_read_only and has_permission() already blocks it then (migration
 * 0001) -- exactly the "billing screen stays reachable for the owner,
 * everything else locks" behavior the doc calls for, with no special-
 * casing needed here.
 */
export default async function BillingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const supabase = await createClient();

  const [user, tenant] = await Promise.all([getCurrentUser(), getTenantBySlug(supabase, tenantSlug)]);

  const tenantId = tenant!.id;
  const isBillingOwner = tenant!.billing_owner_profile_id === user?.id;

  if (!isBillingOwner && !(await can("settings.manage", { tenantId }))) {
    redirect(`/t/${tenantSlug}/more`);
  }

  const billingService = new BillingService(supabase);
  const [subscription, payments, plans, availableCredit] = await Promise.all([
    billingService.getSubscription(tenantId),
    billingService.listPayments(tenantId),
    billingService.listPlans(),
    billingService.getAvailableCredit(tenantId),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <BackLink href={`/t/${tenantSlug}/more`} label="More" />
      <h1 className="text-xl font-semibold">Billing</h1>
      {subscription && (
        <BillingStatusCard
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          subscription={subscription}
          plans={plans}
          canPay={isBillingOwner}
          availableCredit={availableCredit}
        />
      )}
      <PaymentHistoryList payments={payments} />
    </div>
  );
}
