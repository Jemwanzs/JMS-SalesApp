"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
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
