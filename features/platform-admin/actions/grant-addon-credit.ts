"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AddonKey } from "@/types/database.types";
import type { TenantAddonActionState } from "@/features/platform-admin/actions/activate-addon";

export async function grantAddonCreditAction(
  tenantId: string,
  addonKey: AddonKey,
  _prevState: TenantAddonActionState,
  formData: FormData
): Promise<TenantAddonActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  const amount = Number(formData.get("amount"));
  const currency = String(formData.get("currency") ?? "").trim();

  if (!reason) {
    return { error: "A reason is required" };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Amount must be a positive number" };
  }
  if (!currency) {
    return { error: "Currency is required" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).grantAddonCredit(
      platformAdminId,
      tenantId,
      addonKey,
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
