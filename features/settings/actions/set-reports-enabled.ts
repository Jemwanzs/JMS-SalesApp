"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function setReportsEnabledAction(
  tenantId: string,
  tenantSlug: string,
  enabled: boolean
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
    await new TenantService(supabase).setSetting(tenantId, "reports_enabled", enabled, user.id);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        entityId: "reports_enabled",
        newValues: { reports_enabled: enabled },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    revalidatePath(`/t/${tenantSlug}/reports`);
    revalidatePath(`/t/${tenantSlug}/sales`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this setting" };
  }
}
