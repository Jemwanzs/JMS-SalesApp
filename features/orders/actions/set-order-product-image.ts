"use server";

import { revalidatePath } from "next/cache";

import { OrderProductService } from "@/services/OrderProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface SetOrderProductImageState {
  error?: string;
  success?: boolean;
}

/** Mirrors set-tenant-logo.ts's shape; null storagePath/publicUrl means "remove the image." */
export async function setOrderProductImageAction(
  tenantId: string,
  tenantSlug: string,
  orderProductId: string,
  storagePath: string | null,
  publicUrl: string | null
): Promise<SetOrderProductImageState> {
  const supabase = await createClient();
  const service = new OrderProductService(supabase);

  try {
    await assertCan("orders.manage_products", { tenantId });

    if (storagePath && publicUrl) {
      await service.setImage(tenantId, orderProductId, storagePath, publicUrl);
    } else {
      await service.removeImage(tenantId, orderProductId);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save the image" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/products`);
  return { success: true };
}
