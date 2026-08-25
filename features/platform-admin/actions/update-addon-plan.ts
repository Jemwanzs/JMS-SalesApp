"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface AddonPlanActionState {
  error?: string;
  success?: boolean;
}

export async function updateAddonPlanAction(
  planId: string,
  _prevState: AddonPlanActionState,
  formData: FormData
): Promise<AddonPlanActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  const price = Number(formData.get("price"));
  const durationDays = Number(formData.get("durationDays"));
  const discountPercent = Number(formData.get("discountPercent") ?? 0);
  const isActive = formData.get("isActive") === "on";

  if (!reason) {
    return { error: "A reason is required" };
  }
  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be a non-negative number" };
  }
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    return { error: "Duration must be a positive number of days" };
  }
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    return { error: "Discount must be between 0 and 100" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).updateAddonPlan(
      platformAdminId,
      planId,
      { price, durationDays, discountPercent, isActive },
      reason
    );
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update plan" };
  }

  revalidatePath("/admin/addons");
  return { success: true };
}
