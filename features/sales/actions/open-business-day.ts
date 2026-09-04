"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { DownloadService } from "@/services/DownloadService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function openBusinessDayAction(
  tenantId: string,
  tenantSlug: string,
  locationId: string,
  /** Only checked when the tenant has require_download_passcode on --
   * see below. Same tenant-wide passcode Security's "Download security"
   * card already sets, doubling as this gate too (one memorized
   * passcode, not a second one to configure) -- mirrors reopen-
   * business-day.ts's own reuse of it. */
  passcode?: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const businessDayService = new BusinessDayService(supabase);

  try {
    // business_days_write RLS (migration 0005) only checks "holds ANY
    // business_day.* permission" -- a coarse ceiling, by its own header
    // comment's admission, that the service layer is meant to narrow.
    // Without this, a member holding only business_day.close/reopen
    // (not .open) could still open a day via this action.
    await assertCan("business_day.open", { tenantId });

    // Gated on whether a passcode has been CREATED at all
    // (hashed_download_passcode), not require_download_passcode (that
    // toggle only governs *downloads* -- see DownloadSecurityCard's own
    // header comment). Matches reopen's existing precedent: opening is
    // more routine than reopening a closed day, so a tenant that's
    // never set a passcode up sees no change in behavior at all, rather
    // than being unconditionally blocked the way reopen is when neither
    // MFA nor a passcode exists.
    const hashedPasscode = await new TenantService(supabase).getSetting<string>(tenantId, "hashed_download_passcode");
    if (hashedPasscode) {
      const valid = passcode ? await new DownloadService(supabase).verifyPasscode(tenantId, passcode) : false;
      if (!valid) {
        return { error: "Opening the business day requires your workspace's security passcode." };
      }
    }

    const day = await businessDayService.openDay(tenantId, locationId, user.id);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.BUSINESS_DAY_OPENED,
        entityType: "business_day",
        entityId: day.id,
      })
      .catch(() => {});
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not open business day",
    };
  }

  revalidatePath(`/t/${tenantSlug}/sales`);
  return {};
}
