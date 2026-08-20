"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { AnniversaryService } from "@/services/AnniversaryService";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface TenantActionState {
  error?: string;
  success?: boolean;
}

export async function sendAdHocWishAction(
  tenantId: string,
  _prevState: TenantActionState,
  formData: FormData
): Promise<TenantActionState> {
  const message = String(formData.get("message") ?? "").trim();
  if (!message) {
    return { error: "A message is required" };
  }

  const platformAdminId = await requirePlatformAdminId();
  const serviceRole = createServiceRoleClient();

  try {
    await new AnniversaryService(serviceRole).sendAdHocWish(tenantId, message);
    await new PlatformAdminService(serviceRole)
      .logAction(platformAdminId, "TENANT_ANNIVERSARY_WISH_SENT", tenantId, null, null, { message }, null)
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send this wish" };
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { success: true };
}
