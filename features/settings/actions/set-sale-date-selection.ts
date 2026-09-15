"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetSaleDateSelectionState {
  error?: string;
  success?: boolean;
}

/**
 * Backs sale_date_selection_enabled + sale_date_max_backdating_days --
 * read by resolve_backdated_business_day() (migration 0090) at
 * enforcement time. Who can actually use the enabled field is a Roles
 * & Permissions concern ("Record a new sale directly onto a past
 * date"), same "who" (permission) vs "when/whether" (this card) split
 * SaleEditingDeletionCard already establishes.
 *
 * Never writes an actual JSON null for "Unlimited" -- same reasoning
 * set-stock-variance-tolerance.ts's own header comment documents
 * (tenant_settings has no DELETE policy, and the RPC's numeric cast on
 * a stored JSON null fails outright). -1 is the "no limit" sentinel
 * instead; resolve_backdated_business_day() treats -1 (or an absent
 * row) the same as no limit.
 */
export async function setSaleDateSelectionAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetSaleDateSelectionState,
  formData: FormData
): Promise<SetSaleDateSelectionState> {
  const enabled = formData.get("enabled") === "true";
  const maxBackdatingDaysRaw = formData.get("maxBackdatingDays");
  const maxBackdatingDays = maxBackdatingDaysRaw === "" || maxBackdatingDaysRaw === null ? -1 : Number(maxBackdatingDaysRaw);

  if (maxBackdatingDays !== -1 && (!Number.isFinite(maxBackdatingDays) || maxBackdatingDays <= 0)) {
    return { error: "Choose a valid maximum backdating period" };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Not signed in" };
    }

    await assertCan("settings.manage", { tenantId });

    const tenantService = new TenantService(supabase);
    await Promise.all([
      tenantService.setSetting(tenantId, "sale_date_selection_enabled", enabled, user.id),
      tenantService.setSetting(tenantId, "sale_date_max_backdating_days", maxBackdatingDays, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { saleDateSelectionEnabled: enabled, saleDateMaxBackdatingDays: maxBackdatingDays },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    revalidatePath(`/t/${tenantSlug}/sales`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
