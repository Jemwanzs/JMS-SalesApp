"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import {
  locationHoursSchema,
  type LocationHoursInput,
} from "@/validations/onboarding";

export interface UpdateBusinessHoursState {
  error?: string;
  fieldErrors?: Partial<Record<keyof LocationHoursInput, string>>;
  success?: boolean;
}

/**
 * The Workspace page's business-hours card -- same shape as onboarding's
 * saveLocationHoursAction (locationHoursSchema is generic enough to
 * share directly, no field-set mismatch like updateBusinessProfileAction
 * had), but reachable post-onboarding from anywhere, so it needs its
 * own settings.manage gate and its own audit trail rather than piggy-
 * backing on the onboarding action.
 */
export async function updateBusinessHoursAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateBusinessHoursState,
  formData: FormData
): Promise<UpdateBusinessHoursState> {
  await assertCan("settings.manage", { tenantId });

  let hours: unknown;
  try {
    hours = JSON.parse(String(formData.get("hours") ?? "[]"));
  } catch {
    return { error: "Invalid hours data" };
  }

  const parsed = locationHoursSchema.safeParse({
    locationName: formData.get("locationName"),
    address: formData.get("address"),
    hours,
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof LocationHoursInput>(
        parsed.error.issues
      ),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantService = new TenantService(supabase);

  try {
    const { locationId } = await tenantService.upsertPrimaryLocation(tenantId, {
      name: parsed.data.locationName,
      address: parsed.data.address,
    });
    await tenantService.setLocationHours(tenantId, locationId, parsed.data.hours);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not save business hours",
    };
  }

  if (user) {
    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.BUSINESS_HOURS_UPDATED,
        entityType: "location",
        newValues: { locationName: parsed.data.locationName, hours: parsed.data.hours },
      })
      .catch(() => {});
  }

  revalidatePath(`/t/${tenantSlug}/workspace`);
  return { success: true };
}
