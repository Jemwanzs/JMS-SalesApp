"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { ProductService } from "@/services/ProductService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface DeleteProductState {
  error?: string;
  success?: boolean;
}

export async function deleteProductAction(
  tenantId: string,
  tenantSlug: string,
  productId: string,
  productName: string
): Promise<DeleteProductState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("products.archive", { tenantId });
    await new ProductService(supabase).delete(tenantId, productId);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.PRODUCT_DELETED,
        entityType: "product",
        entityId: productId,
        oldValues: { name: productName },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete product" };
  }

  revalidatePath(`/t/${tenantSlug}/products`);
  revalidatePath(`/t/${tenantSlug}/sales`);

  return { success: true };
}
