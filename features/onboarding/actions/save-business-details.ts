"use server";

import { TenantService } from "@/services/TenantService";
import { createClient } from "@/lib/supabase/server";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import {
  businessDetailsSchema,
  type BusinessDetailsInput,
} from "@/validations/onboarding";

export interface SaveBusinessDetailsState {
  error?: string;
  fieldErrors?: Partial<Record<keyof BusinessDetailsInput, string>>;
  success?: boolean;
}

export async function saveBusinessDetailsAction(
  tenantId: string,
  _prevState: SaveBusinessDetailsState,
  formData: FormData
): Promise<SaveBusinessDetailsState> {
  const parsed = businessDetailsSchema.safeParse({
    businessType: formData.get("businessType"),
    website: formData.get("website"),
    anniversaryDate: formData.get("anniversaryDate"),
    currency: formData.get("currency"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof BusinessDetailsInput>(
        parsed.error.issues
      ),
    };
  }

  const supabase = await createClient();
  const tenantService = new TenantService(supabase);

  try {
    await tenantService.updateBusinessDetails(tenantId, {
      ...parsed.data,
      website: parsed.data.website || null,
      anniversaryDate: parsed.data.anniversaryDate || null,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not save business details",
    };
  }

  return { success: true };
}
