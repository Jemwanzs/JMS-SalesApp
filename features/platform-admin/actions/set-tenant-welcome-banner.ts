"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetTenantWelcomeBannerState {
  error?: string;
  success?: boolean;
}

export async function setTenantWelcomeBannerAction(
  tenantId: string,
  enabled: boolean,
  _prevState: SetTenantWelcomeBannerState,
  formData: FormData
): Promise<SetTenantWelcomeBannerState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "A reason is required" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).setTenantWelcomeBanner(platformAdminId, tenantId, enabled, reason);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update the welcome banner setting" };
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { success: true };
}
