"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { TenantService } from "@/services/TenantService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import {
  businessProfileSchema,
  type BusinessProfileInput,
} from "@/validations/workspace";

export interface UpdateBusinessProfileState {
  error?: string;
  fieldErrors?: Partial<Record<keyof BusinessProfileInput, string>>;
  success?: boolean;
}

/**
 * The Workspace page's business-profile card (name/type/website/
 * anniversary/currency/timezone) -- the same fields onboarding's Step 1
 * writes, plus the business name it doesn't. Unlike
 * saveBusinessDetailsAction (only reachable mid-onboarding, before a
 * real role assignment could even be checked meaningfully), this is
 * reachable from anywhere post-onboarding, so it needs its own
 * settings.manage gate matching every other Settings-adjacent action.
 */
export async function updateBusinessProfileAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: UpdateBusinessProfileState,
  formData: FormData
): Promise<UpdateBusinessProfileState> {
  await assertCan("settings.manage", { tenantId });

  const parsed = businessProfileSchema.safeParse({
    businessName: formData.get("businessName"),
    businessType: formData.get("businessType"),
    website: formData.get("website"),
    anniversaryDate: formData.get("anniversaryDate"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof BusinessProfileInput>(
        parsed.error.issues
      ),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantService = new TenantService(supabase);

  try {
    await tenantService.updateBusinessDetails(tenantId, {
      name: parsed.data.businessName,
      businessType: parsed.data.businessType,
      website: parsed.data.website || null,
      anniversaryDate: parsed.data.anniversaryDate || null,
      currency: parsed.data.currency,
      timezone: parsed.data.timezone,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not save business profile",
    };
  }

  if (user) {
    await new AuditService(createServiceRoleClient())
      .log({
        tenantId,
        actorProfileId: user.id,
        action: AUDIT_ACTION.BUSINESS_PROFILE_UPDATED,
        entityType: "tenant",
        entityId: tenantId,
        newValues: parsed.data,
      })
      .catch(() => {});
  }

  revalidatePath(`/t/${tenantSlug}/workspace`);
  return { success: true };
}
