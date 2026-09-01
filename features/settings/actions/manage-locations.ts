"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { LocationService } from "@/services/LocationService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface LocationActionState {
  error?: string;
  success?: boolean;
}

/**
 * Multi-Branch User Access Phase 2 -- create/update/deactivate/
 * reactivate a tenant's branches. All four share the same shape
 * (assertCan -> get the actor -> call LocationService -> log ->
 * revalidate) so they live in one file rather than four near-identical
 * ones, same reasoning ProductRankingCard's three toggles already
 * share one component instead of three.
 */
export async function createLocationAction(
  tenantId: string,
  tenantSlug: string,
  input: { name: string; address?: string; code?: string }
): Promise<LocationActionState> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    const { locationId } = await new LocationService(supabase).createLocation(tenantId, input);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.LOCATION_CREATED,
        entityType: "location",
        entityId: locationId,
        newValues: input,
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this branch" };
  }
}

export async function updateLocationAction(
  tenantId: string,
  tenantSlug: string,
  locationId: string,
  input: { name?: string; address?: string; code?: string }
): Promise<LocationActionState> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new LocationService(supabase).updateLocation(tenantId, locationId, input);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.LOCATION_UPDATED,
        entityType: "location",
        entityId: locationId,
        newValues: input,
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this branch" };
  }
}

export async function deactivateLocationAction(
  tenantId: string,
  tenantSlug: string,
  locationId: string
): Promise<LocationActionState> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new LocationService(supabase).deactivateLocation(tenantId, locationId);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.LOCATION_DEACTIVATED,
        entityType: "location",
        entityId: locationId,
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not deactivate this branch" };
  }
}

export async function reactivateLocationAction(
  tenantId: string,
  tenantSlug: string,
  locationId: string
): Promise<LocationActionState> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new LocationService(supabase).reactivateLocation(tenantId, locationId);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.LOCATION_REACTIVATED,
        entityType: "location",
        entityId: locationId,
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not reactivate this branch" };
  }
}
