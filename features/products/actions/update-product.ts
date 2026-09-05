"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ProductService, type Product } from "@/services/ProductService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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

  // Inventory fields (Product Enhancements #3/#5) -- present only when
  // the edit dialog actually rendered the Inventory section (tenant has
  // the module enabled); omitted entirely otherwise, which
  // ProductService.update() treats as "leave unchanged", not "clear".
  const hasInventoryFields = formData.has("tracksInventory");
  const tracksInventory = hasInventoryFields ? formData.get("tracksInventory") === "true" : undefined;
  const rawCostPrice = hasInventoryFields ? String(formData.get("costPrice") ?? "").trim() : undefined;
  const costPrice = hasInventoryFields ? (rawCostPrice ? Number(rawCostPrice) : null) : undefined;
  const unitOfMeasureIsCustom = hasInventoryFields ? formData.get("unitOfMeasureIsCustom") === "true" : undefined;
  const rawUnitOfMeasure = hasInventoryFields ? String(formData.get("unitOfMeasure") ?? "").trim() : undefined;
  const unitOfMeasure = hasInventoryFields ? rawUnitOfMeasure || null : undefined;
  const rawLowStockThreshold = hasInventoryFields ? String(formData.get("lowStockThreshold") ?? "").trim() : undefined;
  const lowStockThreshold = hasInventoryFields ? (rawLowStockThreshold ? Number(rawLowStockThreshold) : null) : undefined;
  const rawSku = hasInventoryFields ? String(formData.get("sku") ?? "").trim() : undefined;
  const sku = hasInventoryFields ? rawSku || null : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const productService = new ProductService(supabase);

  try {
    await assertCan("products.edit", { tenantId });

    const product = await productService.update(tenantId, parsed.data.productId, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      expectedPrice: Number(parsed.data.expectedPrice),
      showExpectedPrice,
      showNameInPhotoView,
      tracksInventory,
      costPrice,
      unitOfMeasure,
      unitOfMeasureIsCustom,
      lowStockThreshold,
      sku,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user?.id ?? null,
        action: AUDIT_ACTION.PRODUCT_EDITED,
        entityType: "product",
        entityId: product.id,
        newValues: { name: product.name, expectedPrice: product.expectedPrice },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/products`);
    revalidatePath(`/t/${tenantSlug}/sales`);

    return { product };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not update product",
    };
  }
}
