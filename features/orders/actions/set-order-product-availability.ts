"use server";

import { revalidatePath } from "next/cache";

import { OrderProductService } from "@/services/OrderProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface SetOrderProductAvailabilityState {
  error?: string;
  success?: boolean;
}

/** Instant single-row save, backing each row's own Ordering switch. */
export async function setOrderProductAvailabilityAction(
  tenantId: string,
  tenantSlug: string,
  productId: string,
  isAvailable: boolean
): Promise<SetOrderProductAvailabilityState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("orders.manage_products", { tenantId });
    await new OrderProductService(supabase).setAvailability(tenantId, productId, isAvailable);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this product" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/products`);
  revalidatePath(`/order/${tenantSlug}`);
  return { success: true };
}
