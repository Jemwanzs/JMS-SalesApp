"use server";

import { revalidatePath } from "next/cache";

import { AnniversaryService } from "@/services/AnniversaryService";
import { requirePlatformAdminId } from "@/features/platform-admin/actions/require-platform-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function sendAnniversaryWishAction(wishId: string, message: string): Promise<{ error?: string }> {
  await requirePlatformAdminId();

  try {
    await new AnniversaryService(createServiceRoleClient()).sendWish(wishId, message);
    revalidatePath("/admin/anniversaries");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send this wish" };
  }
}

export async function skipAnniversaryWishAction(wishId: string): Promise<{ error?: string }> {
  await requirePlatformAdminId();

  try {
    await new AnniversaryService(createServiceRoleClient()).skipWish(wishId);
    revalidatePath("/admin/anniversaries");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not skip this wish" };
  }
}
