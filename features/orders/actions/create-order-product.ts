"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { OrderProductService, type OrderProduct } from "@/services/OrderProductService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { createOrderProductSchema, type CreateOrderProductInput } from "@/validations/order";

export interface CreateOrderProductState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CreateOrderProductInput, string>>;
  success?: boolean;
  orderProduct?: OrderProduct;
}

export async function createOrderProductAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: CreateOrderProductState,
  formData: FormData
): Promise<CreateOrderProductState> {
  const parsed = createOrderProductSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    minimumOrderAmount: formData.get("minimumOrderAmount"),
    isAvailable: formData.get("isAvailable"),
    displayOrder: formData.get("displayOrder") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof CreateOrderProductInput>(parsed.error.issues) };
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

    orderProduct = await new OrderProductService(supabase).create(tenantId, {
      name: parsed.data.name,
      description: parsed.data.description || null,
      minimumOrderAmount: parsed.data.minimumOrderAmount,
      isAvailable: parsed.data.isAvailable ?? true,
      displayOrder: parsed.data.displayOrder ?? 0,
      createdBy: user.id,
    });

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.ORDER_PRODUCT_CREATED,
        entityType: "order_products",
        entityId: orderProduct.id,
        newValues: { name: orderProduct.name, minimumOrderAmount: orderProduct.minimumOrderAmount },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create this product" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/products`);
  return { success: true, orderProduct };
}
