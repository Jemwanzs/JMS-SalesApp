"use server";

import { revalidatePath } from "next/cache";

import { assertCan } from "@/lib/permissions/can";
import { AuditService } from "@/services/AuditService";
import { SalesService, type RecordedSale } from "@/services/SalesService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { recordSaleSchema, type RecordSaleInput } from "@/validations/sale";

export interface RecordSaleState {
  error?: string;
  fieldErrors?: Partial<Record<keyof RecordSaleInput, string>>;
  sale?: RecordedSale;
}

export async function recordSaleAction(
  tenantId: string,
  tenantSlug: string,
  locationId: string,
  businessDayId: string,
  _prevState: RecordSaleState,
  formData: FormData
): Promise<RecordSaleState> {
  const parsed = recordSaleSchema.safeParse({
    productId: formData.get("productId"),
    actualAmount: formData.get("actualAmount"),
    quantity: formData.get("quantity"),
    notes: formData.get("notes"),
    manualProductName: formData.get("manualProductName") || undefined,
    idempotencyKey: formData.get("idempotencyKey"),
    saleDate: formData.get("saleDate") || undefined,
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof RecordSaleInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const salesService = new SalesService(supabase);

  try {
    let targetBusinessDayId = businessDayId;
    let isBackdated = false;

    // Only touch the backdating path at all when a saleDate was actually
    // submitted AND it differs from the business day the client already
    // resolved as "today's" -- equal-to-today is the normal/default case
    // (the field's own useEffect seeds it with todayDate) and must stay
    // exactly the existing fast flow, no extra round trip or permission
    // check, per the "don't change normal behaviour" requirement.
    if (parsed.data.saleDate) {
      const { data: currentDay } = await supabase
        .from("business_days")
        .select("business_date")
        .eq("id", businessDayId)
        .maybeSingle();

      if (currentDay && parsed.data.saleDate !== currentDay.business_date) {
        await assertCan("sales.record_backdated", { tenantId });

        const { data: resolvedBusinessDayId, error: resolveError } = await supabase.rpc(
          "resolve_backdated_business_day",
          {
            p_tenant_id: tenantId,
            p_location_id: locationId,
            p_sale_date: parsed.data.saleDate,
          }
        );

        if (resolveError || !resolvedBusinessDayId) {
          return { error: resolveError?.message ?? "Could not record a sale for that date" };
        }

        targetBusinessDayId = resolvedBusinessDayId;
        isBackdated = true;
      }
    }

    const sale = await salesService.recordSale({
      tenantId,
      locationId,
      businessDayId: targetBusinessDayId,
      productId: parsed.data.productId,
      actualAmount: parsed.data.actualAmount,
      quantity: parsed.data.quantity === "" ? null : parsed.data.quantity,
      notes: parsed.data.notes || null,
      manualProductName: parsed.data.manualProductName || null,
      recordedBy: user.id,
      idempotencyKey: parsed.data.idempotencyKey,
      allowBackdated: isBackdated,
    });

    if (!sale.replayed) {
      await new AuditService(createServiceRoleClient())
        .log({
          tenantId,
          actorProfileId: user.id,
          action: AUDIT_ACTION.SALE_CREATED,
          entityType: "sale",
          entityId: sale.id,
          newValues: {
            saleNumber: sale.saleNumber,
            actualAmount: sale.actualAmount,
            ...(isBackdated ? { isBackdated: true, saleDate: parsed.data.saleDate } : {}),
          },
        })
        .catch(() => {});
    }

    revalidatePath(`/t/${tenantSlug}/sales`);
    return { sale };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not record sale",
    };
  }
}
