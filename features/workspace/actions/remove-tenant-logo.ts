"use server";

import { revalidatePath } from "next/cache";

import { TenantService } from "@/services/TenantService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface RemoveTenantLogoState {
  error?: string;
  success?: boolean;
}

export async function removeTenantLogoAction(tenantId: string, tenantSlug: string): Promise<RemoveTenantLogoState> {
  const supabase = await createClient();
  const tenantService = new TenantService(supabase);

  try {
    await assertCan("settings.manage", { tenantId });
    await tenantService.removeLogo(tenantId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove the logo" };
  }

  revalidatePath(`/t/${tenantSlug}`, "layout");

  return { success: true };
}
