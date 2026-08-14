"use server";

import { TenantService } from "@/services/TenantService";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import {
  locationHoursSchema,
  type LocationHoursInput,
} from "@/validations/onboarding";

export interface SaveLocationHoursState {
  error?: string;
  fieldErrors?: Partial<Record<keyof LocationHoursInput, string>>;
  success?: boolean;
}

export async function saveLocationHoursAction(
  tenantId: string,
  _prevState: SaveLocationHoursState,
  formData: FormData
): Promise<SaveLocationHoursState> {
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

  return { success: true };
}
