"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface TenantActionState {
  error?: string;
  success?: boolean;
}

/**
 * `currency` is sourced from the tenant's own `tenants.currency` (passed
 * as a hidden field by the form, never free-typed) -- a credit granted
 * in the wrong currency would silently never match at checkout
 * (BillingService.initializeCheckout only applies a credit whose
 * currency equals the plan's), so the UI never offers a currency
 * choice at all.
 */
export async function grantSubscriptionCreditAction(
  tenantId: string,
  _prevState: TenantActionState,
  formData: FormData
): Promise<TenantActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const currency = String(formData.get("currency") ?? "").trim();

  if (!reason) {
    return { error: "A reason is required" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be greater than 0" };
  }
  if (!currency) {
    return { error: "Currency is required" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).grantSubscriptionCredit(
      platformAdminId,
      tenantId,
      amount,
      currency,
      reason
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not grant credit" };
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { success: true };
}
