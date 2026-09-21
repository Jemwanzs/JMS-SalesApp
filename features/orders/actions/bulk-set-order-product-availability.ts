"use server";

import { revalidatePath } from "next/cache";

import { OrderProductService } from "@/services/OrderProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface BulkSetOrderProductAvailabilityState {
  error?: string;
  success?: boolean;
}

/** Backs Select All / Deselect All -- one bulk call, not one per row. */
export async function bulkSetOrderProductAvailabilityAction(
  tenantId: string,
  tenantSlug: string,
  productIds: string[],
  isAvailable: boolean
): Promise<BulkSetOrderProductAvailabilityState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("orders.manage_products", { tenantId });
    await new OrderProductService(supabase).bulkSetAvailability(tenantId, productIds, isAvailable);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update these products" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/products`);
  revalidatePath(`/order/${tenantSlug}`);
  return { success: true };
}
