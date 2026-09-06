"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetSaleEditingDeletionState {
  error?: string;
  success?: boolean;
}

/**
 * Backs the four settings correct_sale()/delete_sale() (migration 0074)
 * read at write time: sale_edit_window_mode/_hours and
 * sale_deletion_enabled/sale_delete_window_minutes. Sale Editing itself
 * has no separate "enabled" tenant_settings key -- turning it off
 * tenant-wide is done via the Edit/Correct Sales role permission
 * (Roles & Permissions), not a second kill switch here; this form only
 * configures WHEN editing is allowed, matching the spec's own split
 * between "who" (permission) and "when" (this card).
 */
export async function setSaleEditingDeletionAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetSaleEditingDeletionState,
  formData: FormData
): Promise<SetSaleEditingDeletionState> {
  const editWindowMode = formData.get("editWindowMode");
  const editWindowHours = Number(formData.get("editWindowHours"));
  const deletionEnabled = formData.get("deletionEnabled") === "true";
  const deleteWindowMinutes = Number(formData.get("deleteWindowMinutes"));

  if (editWindowMode !== "business_day" && editWindowMode !== "hours") {
    return { error: "Choose a valid edit window mode" };
  }
  if (!Number.isFinite(editWindowHours) || editWindowHours <= 0) {
    return { error: "Enter a valid number of hours (greater than 0)" };
  }
  if (!Number.isFinite(deleteWindowMinutes) || deleteWindowMinutes < 0) {
    return { error: "Enter a valid number of minutes (0 or greater)" };
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
      tenantService.setSetting(tenantId, "sale_edit_window_mode", editWindowMode, user.id),
      tenantService.setSetting(tenantId, "sale_edit_window_hours", editWindowHours, user.id),
      tenantService.setSetting(tenantId, "sale_deletion_enabled", deletionEnabled, user.id),
      tenantService.setSetting(tenantId, "sale_delete_window_minutes", deleteWindowMinutes, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { editWindowMode, editWindowHours, deletionEnabled, deleteWindowMinutes },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
