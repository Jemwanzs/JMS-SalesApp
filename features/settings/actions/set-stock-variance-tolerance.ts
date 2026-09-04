"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetStockVarianceToleranceState {
  error?: string;
  success?: boolean;
}

/**
 * Backs the two settings `record_stock_reconciliation()` reads at write
 * time (migration 0067) -- `stock_variance_tolerance_percent`/`_amount`.
 * Always writes a real number, never a stored JSON `null`: the RPC casts
 * the raw tenant_settings value straight to numeric (`(value)::text::
 * numeric`), and a JSON null renders as the literal string `'null'`,
 * which fails that cast outright -- there is no DELETE policy on
 * tenant_settings to fall back to "just remove the row" instead, so the
 * form (and this validation) simply never lets the field go empty; it's
 * pre-filled with the RPC's own hardcoded fallback (2 / 0) the first
 * time, and stays a real number from then on.
 */
export async function setStockVarianceToleranceAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetStockVarianceToleranceState,
  formData: FormData
): Promise<SetStockVarianceToleranceState> {
  const percent = Number(formData.get("tolerancePercent"));
  const amount = Number(formData.get("toleranceAmount"));

  if (!Number.isFinite(percent) || percent < 0) {
    return { error: "Enter a valid percentage (0 or greater)" };
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return { error: "Enter a valid amount (0 or greater)" };
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
      tenantService.setSetting(tenantId, "stock_variance_tolerance_percent", percent, user.id),
      tenantService.setSetting(tenantId, "stock_variance_tolerance_amount", amount, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { stock_variance_tolerance_percent: percent, stock_variance_tolerance_amount: amount },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
