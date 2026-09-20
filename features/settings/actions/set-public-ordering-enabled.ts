"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Independent from orders_enabled -- the module can be ON for staff-
 * side management (Order Products, and later the staff order
 * dashboard) while the public storefront itself stays OFF. The actual
 * public /order/{slug} route doesn't exist until Phase 2b; this toggle
 * exists now so the Settings card's full shape ships together with the
 * rest of Phase 2a rather than needing a later settings-page change.
 */
export async function setPublicOrderingEnabledAction(
  tenantId: string,
  tenantSlug: string,
  enabled: boolean
): Promise<{ error?: string }> {
  await assertCan("settings.manage", { tenantId });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new TenantService(supabase).setSetting(tenantId, "public_ordering_enabled", enabled, user.id);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        entityId: "public_ordering_enabled",
        newValues: { public_ordering_enabled: enabled },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this setting" };
  }
}
