"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface SetOrderReceiptSettingsState {
  error?: string;
  success?: boolean;
}

/**
 * Backs the seven receipt_* branding settings the receipt generator
 * (lib/utils/generate-order-receipt-pdf.ts) and its preview dialog read
 * at generation time -- same "one form, one Save" shape as
 * set-customer-orders-content.ts, since none of these need instant
 * same-page reactivity with anything else on the Settings page.
 */
export async function setOrderReceiptSettingsAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: SetOrderReceiptSettingsState,
  formData: FormData
): Promise<SetOrderReceiptSettingsState> {
  const showLogo = formData.get("receiptShowLogo") === "true";
  const width = String(formData.get("receiptWidth") ?? "80mm");
  const backgroundColor = String(formData.get("receiptBackgroundColor") ?? "").trim();
  const textColor = String(formData.get("receiptTextColor") ?? "").trim();
  const showCustomerMobile = formData.get("receiptShowCustomerMobile") === "true";
  const showDeliveryPerson = formData.get("receiptShowDeliveryPerson") === "true";
  const footerMessage = String(formData.get("receiptFooterMessage") ?? "").trim();

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
      tenantService.setSetting(tenantId, "receipt_show_logo", showLogo, user.id),
      tenantService.setSetting(tenantId, "receipt_width", width, user.id),
      tenantService.setSetting(tenantId, "receipt_background_color", backgroundColor || null, user.id),
      tenantService.setSetting(tenantId, "receipt_text_color", textColor || null, user.id),
      tenantService.setSetting(tenantId, "receipt_show_customer_mobile", showCustomerMobile, user.id),
      tenantService.setSetting(tenantId, "receipt_show_delivery_person", showDeliveryPerson, user.id),
      tenantService.setSetting(tenantId, "receipt_footer_message", footerMessage || null, user.id),
    ]);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        newValues: { receiptShowLogo: showLogo, receiptWidth: width, receiptBackgroundColor: backgroundColor, receiptTextColor: textColor },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save these settings" };
  }
}
