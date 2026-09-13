"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ExpenseApprovalRequirementMode = "never" | "always" | "amount_threshold" | "category";

export interface SetExpenseApprovalRequirementState {
  error?: string;
  success?: boolean;
}

/**
 * Backs the two settings gate_expense_approval() reads at write time
 * (migration 0085) -- expense_approval_mode/_amount_threshold. Same
 * "settings.manage gates every card on this page" convention
 * ExpenseReceiptRequirementCard already follows -- reviewing a pending
 * request is a separate, existing permission (approvals.manage), but
 * deciding WHETHER a request gets created at all is a settings.manage
 * decision, same tier as every other card here.
 */
export async function setExpenseApprovalRequirementAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetExpenseApprovalRequirementState,
  formData: FormData
): Promise<SetExpenseApprovalRequirementState> {
  const mode = String(formData.get("mode") ?? "never") as ExpenseApprovalRequirementMode;
  if (!["never", "always", "amount_threshold", "category"].includes(mode)) {
    return { error: "Invalid approval requirement mode" };
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
      tenantService.setSetting(tenantId, "expense_approval_mode", mode, user.id),
      tenantService.setSetting(tenantId, "expense_approval_amount_threshold", threshold, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { expense_approval_mode: mode, expense_approval_amount_threshold: threshold },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
