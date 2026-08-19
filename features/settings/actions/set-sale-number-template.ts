"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { validateSaleNumberTemplate } from "@/lib/utils/sale-number-template";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function setSaleNumberTemplateAction(tenantId: string, tenantSlug: string, template: string): Promise<{ error?: string }> {
  await assertCan("settings.manage", { tenantId });

  const validationError = validateSaleNumberTemplate(template);
  if (validationError) {
    return { error: validationError };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Not signed in" };
  }

  try {
    await new TenantService(supabase).setSetting(tenantId, "sale_number_template", template.trim(), user.id);

    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.TENANT_SETTING_CHANGED,
        entityType: "tenant_settings",
        entityId: "sale_number_template",
        newValues: { sale_number_template: template.trim() },
      })
      .catch(() => {});

    revalidatePath(`/t/${tenantSlug}/settings`);
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save this setting" };
  }
}
