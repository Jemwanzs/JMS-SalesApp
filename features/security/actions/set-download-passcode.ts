"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetDownloadPasscodeState {
  error?: string;
}

export async function setDownloadPasscodeAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetDownloadPasscodeState,
  formData: FormData
): Promise<SetDownloadPasscodeState> {
  await assertCan("settings.manage", { tenantId });

  const passcode = String(formData.get("passcode") ?? "");
  if (passcode.length < 4) {
    return { error: "Passcode must be at least 4 characters" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  await new TenantService(supabase).setDownloadPasscode(tenantId, passcode, user.id);

  // Never the passcode itself, only that it changed -- same "no secrets
  // in audit metadata" rule as every other log-redaction case in this app.
  await new AuditService(createServiceRoleClient())
    .log({
      tenantId,
      actorProfileId: user.id,
      action: AUDIT_ACTION.SECURITY_SETTING_CHANGED,
      entityType: "tenant_settings",
      newValues: { hashed_download_passcode: "[changed]" },
    })
    .catch(() => {});

  revalidatePath(`/t/${tenantSlug}/security`);
  return {};
}
