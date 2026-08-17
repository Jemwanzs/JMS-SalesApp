"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ProductService } from "@/services/ProductService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { createProductSchema, type CreateProductInput } from "@/validations/product";

export interface CreateProductState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CreateProductInput, string>>;
  success?: boolean;
}

export async function createProductAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: CreateProductState,
  formData: FormData
): Promise<CreateProductState> {
  const parsed = createProductSchema.safeParse({
    name: formData.get("name"),
    expectedPrice: formData.get("expectedPrice"),
    imageUrl: formData.get("imageUrl"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof CreateProductInput>(
        parsed.error.issues
      ),
    };
  }

  // System-generated, not user-typed -- no Zod message needed for these,
  // just a fallback to "not provided" behavior if absent.
  const id = formData.get("id");
  const imageStoragePath = formData.get("imageStoragePath");
  // Checkbox-style boolean: present ("true") when on, absent when off --
  // read directly rather than through Zod, same reasoning as id/imageStoragePath above.
  const showNameInPhotoView = formData.get("showNameInPhotoView") === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  const productService = new ProductService(supabase);

  try {
    await assertCan("products.create", { tenantId });

    const product = await productService.create(tenantId, {
      id: typeof id === "string" && id ? id : undefined,
      name: parsed.data.name,
      expectedPrice: Number(parsed.data.expectedPrice),
      imageUrl: parsed.data.imageUrl || null,
      imageStoragePath: typeof imageStoragePath === "string" && imageStoragePath ? imageStoragePath : null,
      showNameInPhotoView,
      createdBy: user.id,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.PRODUCT_CREATED,
        entityType: "product",
        entityId: product.id,
        newValues: { name: product.name },
      })
      .catch(() => {});
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not create product",
    };
  }

  revalidatePath(`/t/${tenantSlug}/products`);
  revalidatePath(`/t/${tenantSlug}/sales`);

  return { success: true };
}
