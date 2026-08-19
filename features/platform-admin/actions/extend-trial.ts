"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface TenantActionState {
  error?: string;
  success?: boolean;
}

export async function extendTrialAction(
  tenantId: string,
  _prevState: TenantActionState,
  formData: FormData
): Promise<TenantActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  const days = Number(formData.get("days"));

  if (!reason) {
    return { error: "A reason is required" };
  }
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    return { error: "Days must be between 1 and 365" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).extendTrial(platformAdminId, tenantId, days, reason);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not extend trial" };
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/tenants");
  return { success: true };
}
