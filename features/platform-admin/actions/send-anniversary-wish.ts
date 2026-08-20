"use server";

import { revalidatePath } from "next/cache";

import { AnniversaryService } from "@/services/AnniversaryService";
import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function sendAnniversaryWishAction(
  tenantId: string,
  wishId: string,
  message: string
): Promise<{ error?: string }> {
  const platformAdminId = await requirePlatformAdminId();
  const serviceRole = createServiceRoleClient();

  try {
    await new AnniversaryService(serviceRole).sendWish(wishId, message);
    await new PlatformAdminService(serviceRole)
      .logAction(platformAdminId, "TENANT_ANNIVERSARY_WISH_SENT", tenantId, null, null, { wishId, message }, null)
      .catch(() => {});
    revalidatePath("/admin/anniversaries");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send this wish" };
  }
}

export async function skipAnniversaryWishAction(tenantId: string, wishId: string): Promise<{ error?: string }> {
  const platformAdminId = await requirePlatformAdminId();
  const serviceRole = createServiceRoleClient();

  try {
    await new AnniversaryService(serviceRole).skipWish(wishId);
    await new PlatformAdminService(serviceRole)
      .logAction(platformAdminId, "TENANT_ANNIVERSARY_WISH_SKIPPED", tenantId, null, null, { wishId }, null)
      .catch(() => {});
    revalidatePath("/admin/anniversaries");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not skip this wish" };
  }
}
