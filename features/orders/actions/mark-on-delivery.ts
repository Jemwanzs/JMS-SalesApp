"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { OrderService } from "@/services/OrderService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { markOrderOnDeliverySchema, type MarkOrderOnDeliveryInput } from "@/validations/order";

export interface MarkOrderOnDeliveryState {
  error?: string;
  fieldErrors?: Partial<Record<keyof MarkOrderOnDeliveryInput, string>>;
  success?: boolean;
}

export async function markOrderOnDeliveryAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: MarkOrderOnDeliveryState,
  formData: FormData
): Promise<MarkOrderOnDeliveryState> {
  const parsed = markOrderOnDeliverySchema.safeParse({
    orderId: formData.get("orderId"),
    deliveryPersonName: formData.get("deliveryPersonName"),
    deliveryPersonMobile: formData.get("deliveryPersonMobile"),
    deliveryNotes: formData.get("deliveryNotes") || undefined,
  });

  if (!parsed.success) {
    return { fieldErrors: firstIssuePerField<keyof MarkOrderOnDeliveryInput>(parsed.error.issues) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await assertCan("orders.mark_on_delivery", { tenantId });

    const service = new OrderService(supabase);
    await service.markOnDelivery(
      parsed.data.orderId,
      parsed.data.deliveryPersonName,
      parsed.data.deliveryPersonMobile,
      parsed.data.deliveryNotes || null
    );

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.ORDER_MARKED_ON_DELIVERY,
        entityType: "orders",
        entityId: parsed.data.orderId,
        newValues: { deliveryPersonName: parsed.data.deliveryPersonName, deliveryPersonMobile: parsed.data.deliveryPersonMobile },
      })
      .catch(() => {});
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not mark this order as on delivery" };
  }

  revalidatePath(`/t/${tenantSlug}/orders/${parsed.data.orderId}`);
  revalidatePath(`/t/${tenantSlug}/orders`);
  return { success: true };
}
