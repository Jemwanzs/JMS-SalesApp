"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ExpenseReceiptRequirementMode = "never" | "always" | "amount_threshold" | "category";

export interface SetExpenseReceiptRequirementState {
  error?: string;
  success?: boolean;
}

/**
 * Backs the two settings enforce_receipt_requirement() reads at write
 * time (migration 0083) -- expense_receipt_requirement_mode/
 * _amount_threshold. Same "settings.manage gates every card on this
 * page" convention StockVarianceToleranceCard already follows -- no
 * separate expenses.manage_settings permission (see the approved plan's
 * own note on why that would be decorative here).
 */
export async function setExpenseReceiptRequirementAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetExpenseReceiptRequirementState,
  formData: FormData
): Promise<SetExpenseReceiptRequirementState> {
  const mode = String(formData.get("mode") ?? "never") as ExpenseReceiptRequirementMode;
  if (!["never", "always", "amount_threshold", "category"].includes(mode)) {
    return { error: "Invalid receipt requirement mode" };
  }

  const thresholdRaw = formData.get("amountThreshold");
  const threshold = thresholdRaw ? Number(thresholdRaw) : 0;
  if (!Number.isFinite(threshold) || threshold < 0) {
    return { error: "Enter a valid amount threshold (0 or greater)" };
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
      tenantService.setSetting(tenantId, "expense_receipt_requirement_mode", mode, user.id),
      tenantService.setSetting(tenantId, "expense_receipt_requirement_amount_threshold", threshold, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { expense_receipt_requirement_mode: mode, expense_receipt_requirement_amount_threshold: threshold },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
