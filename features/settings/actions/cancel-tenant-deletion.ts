"use server";

import { redirect } from "next/navigation";

import { TenantService } from "@/services/TenantService";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface CancelTenantDeletionState {
  error?: string;
}

/**
 * Cancels a pending self-service deletion request from within the
 * 30-day grace period. Deliberately no assertCan() here -- the tenant
 * is deactivated, so has_permission() would zero out for everyone
 * regardless of role. TenantService.cancelDeletion does the real
 * authorization itself (deletion_requested_by === caller).
 */
export async function cancelTenantDeletionAction(tenantId: string, tenantSlug: string): Promise<CancelTenantDeletionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new TenantService(createServiceRoleClient()).cancelDeletion(tenantId, user.id);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not cancel the deletion request" };
  }

  redirect(`/t/${tenantSlug}`);
}
