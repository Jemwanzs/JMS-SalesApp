"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface TenantActionState {
  error?: string;
  success?: boolean;
}

/**
 * Permanent -- unlike suspend/deactivate, there's nothing to undo this
 * from. On success this redirects away from the (now-404ing) detail page
 * instead of just revalidating and returning {success: true} the way the
 * other tenant actions do. redirect() is called OUTSIDE the try/catch --
 * it works by throwing a special exception Next.js itself catches to
 * perform the navigation, so catching it locally here would silently
 * break that.
 */
export async function deleteTenantAction(
  tenantId: string,
  _prevState: TenantActionState,
  formData: FormData
): Promise<TenantActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "A reason is required" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).deleteTenant(platformAdminId, tenantId, reason);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete tenant" };
  }

  revalidatePath("/admin/tenants");
  redirect("/admin/tenants");
}
