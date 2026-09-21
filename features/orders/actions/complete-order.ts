"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { OrderService } from "@/services/OrderService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface CompleteOrderState {
  error?: string;
  success?: boolean;
}

export async function completeOrderAction(tenantId: string, tenantSlug: string, orderId: string): Promise<CompleteOrderState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("orders.complete", { tenantId });

    await new OrderService(supabase).completeOrder(orderId);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.ORDER_COMPLETED,
        entityType: "orders",
        entityId: orderId,
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not complete this order" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/${orderId}`);
  revalidatePath(`/t/${tenantSlug}/orders`);
  return { success: true };
}
