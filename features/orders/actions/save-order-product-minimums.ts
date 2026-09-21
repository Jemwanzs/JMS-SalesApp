"use server";

import { revalidatePath } from "next/cache";

import { OrderProductService } from "@/services/OrderProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface SaveOrderProductMinimumsState {
  error?: string;
  success?: boolean;
}

/** Backs the batch "Save Changes" button -- one multi-row upsert for every dirty minimum-order input. */
export async function saveOrderProductMinimumsAction(
  tenantId: string,
  tenantSlug: string,
  entries: { productId: string; minimumOrderAmount: number }[]
): Promise<SaveOrderProductMinimumsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  if (entries.some((e) => !Number.isFinite(e.minimumOrderAmount) || e.minimumOrderAmount < 0)) {
    return { error: "Enter a valid minimum order amount (0 or more) for every product" };
  }

  try {
    await assertCan("orders.manage_products", { tenantId });
    await new OrderProductService(supabase).saveMinimumOrderAmounts(tenantId, entries);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these minimums" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/products`);
  revalidatePath(`/order/${tenantSlug}`);
  return { success: true };
}
