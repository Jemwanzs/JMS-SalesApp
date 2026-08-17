"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { reopenBusinessDaySchema, type ReopenBusinessDayInput } from "@/validations/business-day";
import type { ReopenBusinessDayResult } from "@/types/database.types";

export interface ReopenBusinessDayState {
  error?: string;
  fieldErrors?: Partial<Record<keyof ReopenBusinessDayInput, string>>;
  result?: ReopenBusinessDayResult;
}

export async function reopenBusinessDayAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: ReopenBusinessDayState,
  formData: FormData
): Promise<ReopenBusinessDayState> {
  const parsed = reopenBusinessDaySchema.safeParse({
    businessDayId: formData.get("businessDayId"),
    reason: formData.get("reason"),
    until: formData.get("until"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof ReopenBusinessDayInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const businessDayService = new BusinessDayService(supabase);

  try {
    await assertCan("business_day.reopen", { tenantId });

    const result = await businessDayService.reopenDay(
      parsed.data.businessDayId,
      parsed.data.reason,
      new Date(parsed.data.until)
    );

    if (result.status === "reopened") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await new AuditService(createServiceRoleClient())
        .log({
          tenantId,
          actorProfileId: user?.id ?? null,
          action: AUDIT_ACTION.BUSINESS_DAY_REOPENED,
          entityType: "business_day",
          entityId: parsed.data.businessDayId,
          reason: parsed.data.reason,
          metadata: { until: parsed.data.until },
        })
        .catch(() => {});
    }

    revalidatePath(`/t/${tenantSlug}/sales`);
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not reopen business day",
    };
  }
}
