"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { OrderProductService } from "@/services/OrderProductService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface ArchiveOrderProductState {
  error?: string;
  success?: boolean;
}

/** Toggles active <-> archived, same "one action covers both directions" idiom as expense items. */
export async function setOrderProductStatusAction(
  tenantId: string,
  tenantSlug: string,
  orderProductId: string,
  nextStatus: "active" | "archived"
): Promise<ArchiveOrderProductState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("orders.manage_products", { tenantId });

    const service = new OrderProductService(supabase);
    if (nextStatus === "archived") {
      await service.archive(tenantId, orderProductId);
    } else {
      await service.reactivate(tenantId, orderProductId);
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.ORDER_PRODUCT_ARCHIVED,
        entityType: "order_products",
        entityId: orderProductId,
        newValues: { status: nextStatus },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update this product" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/products`);
  return { success: true };
}
