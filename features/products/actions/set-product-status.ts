"use server";

import { revalidatePath } from "next/cache";

import { ProductService } from "@/services/ProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { setProductStatusSchema, type SetProductStatusInput } from "@/validations/product";

export interface SetProductStatusState {
  error?: string;
  fieldErrors?: Partial<Record<keyof SetProductStatusInput, string>>;
  success?: boolean;
}

export async function setProductStatusAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetProductStatusState,
  formData: FormData
): Promise<SetProductStatusState> {
  const parsed = setProductStatusSchema.safeParse({
    productId: formData.get("productId"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    return { error: "Invalid request" };
  }

  const supabase = await createClient();
  const productService = new ProductService(supabase);

  try {
    await assertCan("products.edit", { tenantId });
    await productService.setStatus(tenantId, parsed.data.productId, parsed.data.status);
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update product status",
    };
  }

  revalidatePath(`/t/${tenantSlug}/products`);
  revalidatePath(`/t/${tenantSlug}/sales`);

  return { success: true };
}
