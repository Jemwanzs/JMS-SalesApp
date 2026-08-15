"use server";

import { revalidatePath } from "next/cache";

import { ProductService } from "@/services/ProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export interface RemoveProductImageState {
  error?: string;
  success?: boolean;
}

export async function removeProductImageAction(
  tenantId: string,
  tenantSlug: string,
  productId: string
): Promise<RemoveProductImageState> {
  const supabase = await createClient();
  const productService = new ProductService(supabase);

  try {
    await assertCan("products.edit", { tenantId });
    await productService.removeImage(tenantId, productId);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not remove product image",
    };
  }

  revalidatePath(`/t/${tenantSlug}/products`);
  revalidatePath(`/t/${tenantSlug}/sales`);

  return { success: true };
}
