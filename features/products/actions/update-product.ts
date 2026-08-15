"use server";

import { revalidatePath } from "next/cache";

import { ProductService, type Product } from "@/services/ProductService";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { updateProductSchema, type UpdateProductInput } from "@/validations/product";

export interface UpdateProductState {
  error?: string;
  fieldErrors?: Partial<Record<keyof UpdateProductInput, string>>;
  product?: Product;
}

export async function updateProductAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateProductState,
  formData: FormData
): Promise<UpdateProductState> {
  const parsed = updateProductSchema.safeParse({
    productId: formData.get("productId"),
    name: formData.get("name"),
    description: formData.get("description"),
    expectedPrice: formData.get("expectedPrice"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof UpdateProductInput>(parsed.error.issues),
    };
  }

  // Checkbox-style booleans: read directly rather than through Zod (same
  // reasoning as create-product.ts). The caller always resends the
  // product's current showExpectedPrice unchanged (no UI control for it
  // yet) so an edit never silently resets it -- only showNameInPhotoView
  // has an actual toggle in the edit dialog.
  const showExpectedPrice = formData.get("showExpectedPrice") === "true";
  const showNameInPhotoView = formData.get("showNameInPhotoView") === "true";

  const supabase = await createClient();
  const productService = new ProductService(supabase);

  try {
    await assertCan("products.edit", { tenantId });

    const product = await productService.update(tenantId, parsed.data.productId, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      expectedPrice: Number(parsed.data.expectedPrice),
      showExpectedPrice,
      showNameInPhotoView,
    });

    revalidatePath(`/t/${tenantSlug}/products`);
    revalidatePath(`/t/${tenantSlug}/sales`);

    return { product };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update product",
    };
  }
}
