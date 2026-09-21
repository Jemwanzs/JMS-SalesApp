"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetWhatsAppMessagesState {
  error?: string;
  success?: boolean;
}

/**
 * Backs the two tenant-configurable WhatsApp prefill templates (spec
 * sections 2 and 16 -- the only two the spec explicitly calls out as
 * worth customizing). Same "one form, one Save" shape as
 * set-order-receipt-settings.ts.
 */
export async function setWhatsAppMessagesAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetWhatsAppMessagesState,
  formData: FormData
): Promise<SetWhatsAppMessagesState> {
  const onDeliveryTemplate = String(formData.get("whatsappMessageOnDelivery") ?? "").trim();
  const completedTemplate = String(formData.get("whatsappMessageCompleted") ?? "").trim();

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
      tenantService.setSetting(tenantId, "whatsapp_message_on_delivery", onDeliveryTemplate || null, user.id),
      tenantService.setSetting(tenantId, "whatsapp_message_completed", completedTemplate || null, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { whatsappMessageOnDelivery: onDeliveryTemplate, whatsappMessageCompleted: completedTemplate },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
