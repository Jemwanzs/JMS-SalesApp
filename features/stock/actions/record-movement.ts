"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { StockService, type RecordableMovementType } from "@/services/StockService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { resolveActiveLocationId } from "@/lib/tenant/resolve-active-location";
import { todayString } from "@/lib/utils/date-ranges";

export interface RecordMovementState {
  error?: string;
  success?: boolean;
}

const REASON_REQUIRED: ReadonlySet<RecordableMovementType> = new Set([
  "adjustment_increase",
  "adjustment_decrease",
  "damaged",
  "expired",
  "lost",
]);

export async function recordMovementAction(
  tenantId: string,
  tenantSlug: string,
  productId: string,
  _prevState: RecordMovementState,
  formData: FormData
): Promise<RecordMovementState> {
  const movementType = String(formData.get("movementType")) as RecordableMovementType;
  const quantity = Number(formData.get("quantity"));
  const reason = String(formData.get("reason") ?? "").trim();

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: "Enter a quantity greater than zero" };
  }
  if (REASON_REQUIRED.has(movementType) && !reason) {
    return { error: "A reason is required for this type of movement" };
  }

  try {
    await assertInventoryEnabled(tenantId, "write");
    await assertCan("stock.movement.record", { tenantId });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Not signed in" };
    }

    // Business Day Rollover: attribute this movement to the branch's
    // currently effective business date, not the database server's raw
    // `current_date` -- same reasoning sale_date already follows. Falls
    // back to a plain calendar-today lookup only if no active branch
    // session can be resolved (shouldn't happen in practice for a real
    // signed-in user, but stock recording shouldn't hard-fail on it).
    const locationId = await resolveActiveLocationId(supabase, tenantId);
    const occurredOn = locationId
      ? (await new BusinessDayService(supabase).getEffectiveBusinessDate(tenantId, locationId)).date
      : todayString("UTC");

    await new StockService(supabase).recordMovement(tenantId, {
      productId,
      movementType,
      quantity,
      reason: reason || null,
      recordedBy: user.id,
      occurredOn,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.STOCK_MOVEMENT_RECORDED,
        entityType: "stock_movements",
        entityId: productId,
        newValues: { movementType, quantity, reason: reason || null },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/stock`);
    revalidatePath(`/t/${tenantSlug}/stock/${productId}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record this movement" };
  }
}
