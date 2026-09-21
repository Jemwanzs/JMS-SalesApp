"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { OrderService } from "@/services/OrderService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { cancelOrderSchema, type CancelOrderInput } from "@/validations/order";

export interface CancelOrderState {
  error?: string;
  fieldErrors?: Partial<Record<keyof CancelOrderInput, string>>;
  success?: boolean;
}

export async function cancelOrderAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: CancelOrderState,
  formData: FormData
): Promise<CancelOrderState> {
  const parsed = cancelOrderSchema.safeParse({
    orderId: formData.get("orderId"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof CancelOrderInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("orders.cancel", { tenantId });

    await new OrderService(supabase).cancelOrder(parsed.data.orderId, parsed.data.reason);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.ORDER_CANCELLED,
        entityType: "orders",
        entityId: parsed.data.orderId,
        reason: parsed.data.reason,
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not cancel this order" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/${parsed.data.orderId}`);
  revalidatePath(`/t/${tenantSlug}/orders`);
  return { success: true };
}
