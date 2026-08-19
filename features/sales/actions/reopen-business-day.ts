"use server";

import { revalidatePath } from "next/cache";

import { AuditService } from "@/services/AuditService";
import { BusinessDayService } from "@/services/BusinessDayService";
import { DownloadService } from "@/services/DownloadService";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertCan } from "@/lib/permissions/can";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { firstIssuePerField } from "@/lib/utils/form-errors";
import { reopenBusinessDaySchema, type ReopenBusinessDayInput } from "@/validations/business-day";
import type { ReopenBusinessDayResult } from "@/types/database.types";

export interface ReopenBusinessDayState {
  error?: string;
  fieldErrors?: Partial<Record<keyof ReopenBusinessDayInput, string>>;
  result?: ReopenBusinessDayResult;
}

export async function reopenBusinessDayAction(
  tenantId: string,
  tenantSlug: string,
  _prevState: ReopenBusinessDayState,
  formData: FormData
): Promise<ReopenBusinessDayState> {
  const parsed = reopenBusinessDaySchema.safeParse({
    businessDayId: formData.get("businessDayId"),
    reason: formData.get("reason"),
    until: formData.get("until"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: firstIssuePerField<keyof ReopenBusinessDayInput>(parsed.error.issues),
    };
  }

  const supabase = await createClient();
  const businessDayService = new BusinessDayService(supabase);

  try {
    await assertCan("business_day.reopen", { tenantId });

    // docs/09-business-day-engine.md: "requires: reason, MFA or passcode..."
    // -- not an optional tenant toggle the way download security's passcode
    // requirement is (require_download_passcode); reopening a closed day is
    // always gated one way or the other. If the caller's session already
    // reached AAL2 (a real TOTP step-up completed client-side just before
    // this call -- reopen-business-day-dialog.tsx's own MFA prompt, same
    // supabase.auth.mfa.challengeAndVerify() pattern as Phase 7b's
    // impersonation gate), that alone satisfies it. Otherwise the tenant's
    // existing security passcode (hashed_download_passcode, set from the
    // Security Centre's download-security card, which now doubles as this
    // gate too -- one memorized passcode, not a second one to configure)
    // must be supplied and verified. No passcode configured and no MFA
    // enrolled means reopening is correctly impossible until one exists.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const verifiedVia: "mfa" | "passcode" = aal?.currentLevel === "aal2" ? "mfa" : "passcode";
    if (verifiedVia === "passcode") {
      const passcode = String(formData.get("passcode") ?? "");
      const valid = passcode ? await new DownloadService(supabase).verifyPasscode(tenantId, passcode) : false;
      if (!valid) {
        return {
          error:
            "Reopening a business day requires two-factor authentication or your workspace's security passcode. Enable two-factor authentication in Security, or ask an administrator to set a security passcode.",
        };
      }
    }

    const result = await businessDayService.reopenDay(
      parsed.data.businessDayId,
      parsed.data.reason,
      new Date(parsed.data.until)
    );

    if (result.status === "reopened") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      await new AuditService(createServiceRoleClient())
        .log({
          tenantId,
          actorProfileId: user?.id ?? null,
          action: AUDIT_ACTION.BUSINESS_DAY_REOPENED,
          entityType: "business_day",
          entityId: parsed.data.businessDayId,
          reason: parsed.data.reason,
          metadata: { until: parsed.data.until, verifiedVia },
        })
        .catch(() => {});
    }

    revalidatePath(`/t/${tenantSlug}/sales`);
    return { result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Could not reopen business day",
    };
  }
}
