"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    await new TenantService(supabase).setLocationGeofence(tenantId, { latitude, longitude, radiusMeters });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save geofence" };
  }

  await new AuditService(createServiceRoleClient())
    .log({
      tenantId,
      actorProfileId: user?.id ?? null,
      action: AUDIT_ACTION.SECURITY_SETTING_CHANGED,
      entityType: "location",
      newValues: { latitude, longitude, radiusMeters },
    })
    .catch(() => {});

  revalidatePath(`/t/${tenantSlug}/security`);
  return {};
}
