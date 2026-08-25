"use server";

import { revalidatePath } from "next/cache";

import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { PlatformAdminService } from "@/services/PlatformAdminService";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { AddonKey } from "@/types/database.types";

export interface AddonTrialDaysActionState {
  error?: string;
  success?: boolean;
}

export async function setAddonTrialDaysAction(
  addonKey: AddonKey,
  _prevState: AddonTrialDaysActionState,
  formData: FormData
): Promise<AddonTrialDaysActionState> {
  const reason = String(formData.get("reason") ?? "").trim();
  const days = Number(formData.get("days"));

  if (!reason) {
    return { error: "A reason is required" };
  }
  if (!Number.isFinite(days) || days < 0 || days > 365) {
    return { error: "Days must be between 0 and 365" };
  }

  try {
    const platformAdminId = await requirePlatformAdminId();
    await new PlatformAdminService(createServiceRoleClient()).setAddonTrialDays(platformAdminId, addonKey, days, reason);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update trial days" };
  }

  revalidatePath("/admin/addons");
  return { success: true };
}
