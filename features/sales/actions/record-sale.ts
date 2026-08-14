"use server";

import { revalidatePath } from "next/cache";

import { SalesService, type RecordedSale } from "@/services/SalesService";
import { createClient } from "@/lib/supabase/server";
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
    idempotencyKey: formData.get("idempotencyKey"),
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
    const sale = await salesService.recordSale({
      tenantId,
      locationId,
      businessDayId,
      productId: parsed.data.productId,
      actualAmount: parsed.data.actualAmount,
      quantity: parsed.data.quantity === "" ? null : parsed.data.quantity,
      notes: parsed.data.notes || null,
      recordedBy: user.id,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    revalidatePath(`/t/${tenantSlug}/sales`);
    return { sale };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not record sale",
    };
  }
}
