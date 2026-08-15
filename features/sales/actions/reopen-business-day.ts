"use server";

import { revalidatePath } from "next/cache";

import { BusinessDayService } from "@/services/BusinessDayService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
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

    revalidatePath(`/t/${tenantSlug}/sales`);
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not reopen business day",
    };
  }
}
