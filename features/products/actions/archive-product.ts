"use server";

import { revalidatePath } from "next/cache";

import { ProductService } from "@/services/ProductService";
import { createClient } from "@/lib/supabase/server";

export async function archiveProductAction(
  tenantId: string,
  tenantSlug: string,
  productId: string
): Promise<void> {
  const supabase = await createClient();
  const productService = new ProductService(supabase);

  await productService.archive(tenantId, productId);

  revalidatePath(`/t/${tenantSlug}/products`);
  revalidatePath(`/t/${tenantSlug}/sales`);
}
