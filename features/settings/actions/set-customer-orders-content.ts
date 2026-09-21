"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetCustomerOrdersContentState {
  error?: string;
  success?: boolean;
}

/**
 * Backs the four order_* content strings the public storefront reads
 * at render time (features/public-ordering) -- outlet name, welcome
 * message, delivery fee notice, completion message. One form, one
 * Save (mirrors SaleEditingDeletionCard's shape -- these are prose
 * fields edited together, not independent instant toggles).
 */
export async function setCustomerOrdersContentAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetCustomerOrdersContentState,
  formData: FormData
): Promise<SetCustomerOrdersContentState> {
  const outletName = String(formData.get("orderOutletName") ?? "").trim();
  const welcomeMessage = String(formData.get("orderWelcomeMessage") ?? "").trim();
  const deliveryFeeNotice = String(formData.get("orderDeliveryFeeNotice") ?? "").trim();
  const completionMessage = String(formData.get("orderCompletionMessage") ?? "").trim();

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { error: "Not signed in" };
    }

    await assertCan("orders.manage_settings", { tenantId });

    const tenantService = new TenantService(supabase);
    await Promise.all([
      tenantService.setSetting(tenantId, "order_outlet_name", outletName || null, user.id),
      tenantService.setSetting(tenantId, "order_welcome_message", welcomeMessage || null, user.id),
      tenantService.setSetting(tenantId, "order_delivery_fee_notice", deliveryFeeNotice || null, user.id),
      tenantService.setSetting(tenantId, "order_completion_message", completionMessage || null, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { orderOutletName: outletName, orderWelcomeMessage: welcomeMessage, orderDeliveryFeeNotice: deliveryFeeNotice, orderCompletionMessage: completionMessage },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    revalidatePath(`/order/${tenantSlug}`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
