"use server";

import { BillingService } from "@/services/BillingService";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface StartCheckoutState {
  error?: string;
  authorizationUrl?: string;
}

/**
 * Billing access is `tenants.billing_owner_profile_id`, not an RBAC
 * permission (docs/14-billing-paystack.md) -- checked directly here,
 * never via can()/assertCan(), since a suspended tenant's Tenant
 * Administrator role loses every non-read-only permission (settings.
 * manage included) while the billing owner specifically must retain
 * the ability to pay and un-suspend.
 */
export async function startCheckoutAction(tenantId: string, tenantSlug: string, planId: string): Promise<StartCheckoutState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("billing_owner_profile_id")
    .eq("id", tenantId)
    .single();

  if (!tenant || tenant.billing_owner_profile_id !== user.id) {
    return { error: "Only the billing owner can manage billing for this workspace" };
  }

  const billingService = new BillingService(createServiceRoleClient());

  try {
    const result = await billingService.initializeCheckout({
      tenantId,
      planId,
      email: user.email!,
      callbackUrl: `${process.env.NEXT_PUBLIC_APP_URL}/t/${tenantSlug}/billing/callback`,
    });
    return { authorizationUrl: result.authorizationUrl };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start checkout" };
  }
}
