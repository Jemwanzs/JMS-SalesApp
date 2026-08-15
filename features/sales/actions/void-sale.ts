"use server";

import { revalidatePath } from "next/cache";

import { SalesService } from "@/services/SalesService";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { voidSaleSchema, type VoidSaleInput } from "@/validations/sale";
import type { VoidOrCorrectResult } from "@/types/database.types";

export interface VoidSaleState {
  error?: string;
  fieldErrors?: Partial<Record<keyof VoidSaleInput, string>>;
  result?: VoidOrCorrectResult;
}

export async function voidSaleAction(
  tenantSlug: string,
  _prevState: VoidSaleState,
  formData: FormData
): Promise<VoidSaleState> {
  const parsed = voidSaleSchema.safeParse({
    saleId: formData.get("saleId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof VoidSaleInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const salesService = new SalesService(supabase);

  try {
    const result = await salesService.voidSale(parsed.data.saleId, parsed.data.reason);
    revalidatePath(`/t/${tenantSlug}/sales-history`);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not void sale" };
  }
}
