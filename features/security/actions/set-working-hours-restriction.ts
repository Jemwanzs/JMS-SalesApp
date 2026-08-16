"use server";

import { revalidatePath } from "next/cache";

import { TenantService } from "@/services/TenantService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export async function setWorkingHoursRestrictionAction(
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

  // RLS (tenant_settings_upsert/update, migration 0001) enforces
  // settings.manage regardless -- checked here first for a clear error.
  await assertCan("settings.manage", { tenantId });

  await new TenantService(supabase).setSetting(
    tenantId,
    "restrict_login_to_working_hours",
    enabled,
    user.id
  );

  revalidatePath(`/t/${tenantSlug}/security`);
}
