"use server";

import { revalidatePath } from "next/cache";

import { ProductService } from "@/services/ProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { setProductImageSchema } from "@/validations/product";

export interface SetProductImageState {
  error?: string;
  success?: boolean;
}

export async function setProductImageAction(
  tenantId: string,
  tenantSlug: string,
  productId: string,
  storagePath: string,
  imageUrl: string
): Promise<SetProductImageState> {
  const parsed = setProductImageSchema.safeParse({ productId, storagePath, imageUrl });

  if (!parsed.success) {
    return { error: "Invalid image data" };
  }

  const supabase = await createClient();
  const productService = new ProductService(supabase);

  try {
    await assertCan("products.edit", { tenantId });
    await productService.setImage(
      tenantId,
      parsed.data.productId,
      parsed.data.storagePath,
      parsed.data.imageUrl
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not save product image",
    };
  }

  revalidatePath(`/t/${tenantSlug}/products`);
  revalidatePath(`/t/${tenantSlug}/sales`);

  return { success: true };
}
