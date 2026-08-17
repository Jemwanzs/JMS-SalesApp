"use server";

import { revalidatePath } from "next/cache";

import { TenantService } from "@/services/TenantService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

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

  revalidatePath(`/t/${tenantSlug}/security`);
  return {};
}
