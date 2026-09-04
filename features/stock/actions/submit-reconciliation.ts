"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { StockService } from "@/services/StockService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";

export interface SubmitReconciliationState {
  error?: string;
  success?: boolean;
}

/**
 * The RPC's own internal has_permission('stock.reconcile') check IS the
 * enforcement here -- no separate assertCan() needed, same reasoning
 * void_sale/correct_sale's own call sites already rely on (0006).
 */
export async function submitReconciliationAction(
  tenantId: string,
  tenantSlug: string,
  productId: string,
  _prevState: SubmitReconciliationState,
  formData: FormData
): Promise<SubmitReconciliationState> {
  const date = String(formData.get("date") ?? "");
  const actualQuantityRaw = formData.get("actualQuantity");
  const varianceReason = String(formData.get("varianceReason") ?? "").trim();
  const actualRecordedSalesRaw = formData.get("actualRecordedSales");
  const actualRemainingValueRaw = formData.get("actualRemainingValue");
  const validAdjustmentsValueRaw = formData.get("validAdjustmentsValue");

  // Omitted entirely for a value-controlled product (no physical unit
  // count) -- the RPC itself enforces that a quantity-controlled product
  // still requires one (migration 0068), so no client-side requirement
  // is duplicated here.
  const actualQuantity = actualQuantityRaw && actualQuantityRaw !== "" ? Number(actualQuantityRaw) : null;

  if (!date) {
    return { error: "Missing reconciliation date" };
  }
  if (actualQuantity !== null && (!Number.isFinite(actualQuantity) || actualQuantity < 0)) {
    return { error: "Enter the actual physical count" };
  }

  try {
    await assertInventoryEnabled(tenantId, "write");

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Not signed in" };
    }

    const locationId = await resolveActiveLocationId(supabase, tenantId);

    const result = await new StockService(supabase).submitReconciliation(tenantId, {
      productId,
      locationId,
      date,
      actualQuantity,
      varianceReason: varianceReason || null,
      actualRecordedSales: actualRecordedSalesRaw ? Number(actualRecordedSalesRaw) : null,
      actualRemainingValue: actualRemainingValueRaw ? Number(actualRemainingValueRaw) : null,
      validAdjustmentsValue: validAdjustmentsValueRaw ? Number(validAdjustmentsValueRaw) : 0,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.STOCK_RECONCILED,
        entityType: "stock_reconciliations",
        entityId: result.id,
        newValues: { actualQuantity, variance: result.variance, varianceReason: result.varianceReason },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/stock/reconcile`);
    revalidatePath(`/t/${tenantSlug}/stock/${productId}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not submit reconciliation" };
  }
}
