"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function openBusinessDayAction(
  tenantId: string,
  tenantSlug: string,
  locationId: string
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
