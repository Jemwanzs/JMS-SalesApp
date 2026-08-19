"use server";

import { revalidatePath } from "next/cache";

import { ProductService } from "@/services/ProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";

export async function reorderProductsAction(
  tenantId: string,
  tenantSlug: string,
  orderedProductIds: string[]
): Promise<{ error?: string }> {
  await assertCan("products.edit", { tenantId });

  const supabase = await createClient();

  try {
    await new ProductService(supabase).reorder(tenantId, orderedProductIds);
    revalidatePath(`/t/${tenantSlug}/products`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not reorder products" };
  }
}
