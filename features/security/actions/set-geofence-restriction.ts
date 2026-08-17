"use server";

import { revalidatePath } from "next/cache";

import { TenantService } from "@/services/TenantService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export async function setGeofenceRestrictionAction(
  tenantId: string,
  tenantSlug: string,
  enabled: boolean
): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not signed in");
  }

  await assertCan("settings.manage", { tenantId });

  await new TenantService(supabase).setSetting(tenantId, "restrict_login_to_geofence", enabled, user.id);

  revalidatePath(`/t/${tenantSlug}/security`);
}
