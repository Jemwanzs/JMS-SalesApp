"use server";

import { revalidatePath } from "next/cache";

import { TenantService } from "@/services/TenantService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface SetTenantLogoState {
  error?: string;
  success?: boolean;
}

/**
 * User & Tenant Branding Personalization. Same gate as the Workspace
 * page itself (settings.manage) -- "an authorized tenant administrator"
 * maps directly onto the permission that already governs every other
 * business-details edit on this page, not a new one. Mirrors
 * set-product-image.ts's shape.
 */
export async function setTenantLogoAction(
  tenantId: string,
  tenantSlug: string,
  storagePath: string,
  logoUrl: string
): Promise<SetTenantLogoState> {
  if (!storagePath || !logoUrl) {
    return { error: "Invalid logo data" };
  }

  const supabase = await createClient();
  const tenantService = new TenantService(supabase);

  try {
    await assertCan("settings.manage", { tenantId });
    await tenantService.setLogo(tenantId, storagePath, logoUrl);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the logo" };
  }

  // The header that actually displays this lives in the tenant layout,
  // above every route -- revalidate the whole tenant subtree ("layout"
  // type) so it picks up the change immediately, not just /workspace.
  revalidatePath(`/t/${tenantSlug}`, "layout");

  return { success: true };
}
