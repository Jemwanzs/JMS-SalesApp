"use server";

import { revalidatePath } from "next/cache";

import { AnniversaryService, type AnniversaryWishMode } from "@/services/AnniversaryService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export async function setAnniversaryWishModeAction(
  tenantId: string,
  tenantSlug: string,
  mode: AnniversaryWishMode
): Promise<{ error?: string }> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new AnniversaryService(supabase).setWishMode(tenantId, mode, user.id);
    revalidatePath(`/t/${tenantSlug}/settings`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this setting" };
  }
}
