"use server";

import { revalidatePath } from "next/cache";

import { TenantService } from "@/services/TenantService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface SetLocationGeofenceState {
  error?: string;
}

export async function setLocationGeofenceAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetLocationGeofenceState,
  formData: FormData
): Promise<SetLocationGeofenceState> {
  await assertCan("settings.manage", { tenantId });

  const latitude = Number(formData.get("latitude"));
  const longitude = Number(formData.get("longitude"));
  const radiusMeters = Number(formData.get("radiusMeters"));

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return { error: "Latitude must be between -90 and 90" };
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return { error: "Longitude must be between -180 and 180" };
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 50_000) {
    return { error: "Radius must be between 1 and 50,000 meters" };
  }

  const supabase = await createClient();

  try {
    await new TenantService(supabase).setLocationGeofence(tenantId, { latitude, longitude, radiusMeters });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save geofence" };
  }

  revalidatePath(`/t/${tenantSlug}/security`);
  return {};
}
