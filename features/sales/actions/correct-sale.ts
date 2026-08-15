"use server";

import { revalidatePath } from "next/cache";

import { SalesService } from "@/services/SalesService";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { correctSaleSchema, type CorrectSaleInput } from "@/validations/sale";
import type { VoidOrCorrectResult } from "@/types/database.types";

export interface CorrectSaleState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CorrectSaleInput, string>>;
  result?: VoidOrCorrectResult;
}

export async function correctSaleAction(
  tenantSlug: string,
  _prevState: CorrectSaleState,
  formData: FormData
): Promise<CorrectSaleState> {
  const parsed = correctSaleSchema.safeParse({
    saleId: formData.get("saleId"),
    newAmount: formData.get("newAmount"),
    newQuantity: formData.get("newQuantity"),
    newNotes: formData.get("newNotes"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof CorrectSaleInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const salesService = new SalesService(supabase);

  try {
    const result = await salesService.correctSale({
      saleId: parsed.data.saleId,
      newAmount: parsed.data.newAmount,
      newQuantity: parsed.data.newQuantity === "" ? null : parsed.data.newQuantity,
      newNotes: parsed.data.newNotes || null,
      reason: parsed.data.reason,
    });
    revalidatePath(`/t/${tenantSlug}/sales-history`);
    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not correct sale" };
  }
}
