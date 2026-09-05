"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertInventoryEnabled } from "@/lib/inventory/entitlement";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function setStockControlMethodAction(
  tenantId: string,
  tenantSlug: string,
  method: "quantity" | "value"
): Promise<{ error?: string }> {
  await assertCan("settings.manage", { tenantId });
  await assertInventoryEnabled(tenantId, "write");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    const tenantService = new TenantService(supabase);
    await tenantService.setSetting(tenantId, "stock_control_method", method, user.id);

    // Quantity mode requires the Quantity field toggle locked ON (see
    // quantity-field-card.tsx's own `locked` prop) -- flip it here too
    // so a tenant switching TO quantity mode doesn't land in the
    // inconsistent state of "mandatory but the toggle still says off"
    // until they happen to revisit that other card.
    if (method === "quantity") {
      await tenantService.setSetting(tenantId, "quantity_enabled", true, user.id);
    }

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        entityId: "stock_control_method",
        newValues: { stock_control_method: method },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    revalidatePath(`/t/${tenantSlug}/sales`);
    revalidatePath(`/t/${tenantSlug}/stock`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this setting" };
  }
}
