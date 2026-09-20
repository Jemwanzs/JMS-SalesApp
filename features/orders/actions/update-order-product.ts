"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { OrderProductService, type OrderProduct } from "@/services/OrderProductService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { updateOrderProductSchema, type UpdateOrderProductInput } from "@/validations/order";

export interface UpdateOrderProductState {
  error?: string;
  fieldErrors?: Partial<Record<keyof UpdateOrderProductInput, string>>;
  success?: boolean;
  orderProduct?: OrderProduct;
}

export async function updateOrderProductAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateOrderProductState,
  formData: FormData
): Promise<UpdateOrderProductState> {
  const parsed = updateOrderProductSchema.safeParse({
    orderProductId: formData.get("orderProductId"),
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    minimumOrderAmount: formData.get("minimumOrderAmount"),
    isAvailable: formData.get("isAvailable"),
    displayOrder: formData.get("displayOrder") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof UpdateOrderProductInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  let orderProduct: OrderProduct;
  try {
    await assertCan("orders.manage_products", { tenantId });

    orderProduct = await new OrderProductService(supabase).update(tenantId, parsed.data.orderProductId, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      minimumOrderAmount: parsed.data.minimumOrderAmount,
      isAvailable: parsed.data.isAvailable ?? true,
      displayOrder: parsed.data.displayOrder ?? 0,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.ORDER_PRODUCT_EDITED,
        entityType: "order_products",
        entityId: orderProduct.id,
        newValues: { name: orderProduct.name, minimumOrderAmount: orderProduct.minimumOrderAmount },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this product" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/products`);
  return { success: true, orderProduct };
}
