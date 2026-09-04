"use server";

import { redirect } from "next/navigation";

import { TenantService } from "@/services/TenantService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface RequestTenantDeletionState {
  error?: string;
}

/**
 * Account Deletion (Feature 1) -- request + 30-day grace period. Checked
 * here, while the tenant is still active (has_permission() zeroes out
 * the moment TenantService.requestDeletion flips status='deactivated',
 * so this must be the LAST permission check that ever runs for this
 * flow -- everything after it, including cancellation, authorizes off
 * `deletion_requested_by` instead).
 */
export async function requestTenantDeletionAction(tenantId: string): Promise<RequestTenantDeletionState> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new TenantService(createServiceRoleClient()).requestDeletion(tenantId, user.id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not submit the deletion request" };
  }

  redirect("/tenant-deactivated");
}
