"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AddonKey } from "@/types/database.types";
import type { TenantAddonActionState } from "@/features/platform-admin/actions/activate-addon";

export async function deactivateAddonAction(
  tenantId: string,
  addonKey: AddonKey,
  _prevState: TenantAddonActionState,
  formData: FormData
): Promise<TenantAddonActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "A reason is required" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).deactivateAddonForTenant(platformAdminId, tenantId, addonKey, reason);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not deactivate add-on" };
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { success: true };
}
