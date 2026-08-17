"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function setDownloadPasscodeRequirementAction(
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

  await new TenantService(supabase).setSetting(tenantId, "require_download_passcode", enabled, user.id);

  await new AuditService(createServiceRoleClient())
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.SECURITY_SETTING_CHANGED,
      entityType: "tenant_settings",
      newValues: { require_download_passcode: enabled },
    })
    .catch(() => {});

  revalidatePath(`/t/${tenantSlug}/security`);
}
