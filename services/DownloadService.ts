import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { verifyPasscodeHash } from "@/lib/utils/passcode";

/**
 * DownloadService — docs/05-authentication-security.md's "Download
 * security" flow: Enter Passcode → Validate → Permission Check →
 * Generate File → download_audit event. This service owns exactly the
 * passcode-validate and audit-log steps; the caller (an export action
 * like features/sales/actions/export-sales-history.ts) owns the
 * permission check and file generation, since those are specific to
 * whatever's being exported.
 *
 * verifyPasscode() is also reused directly by features/sales/actions/
 * reopen-business-day.ts (Phase 2h's "MFA or passcode" gate,
 * docs/09-business-day-engine.md) for a caller without MFA enrolled —
 * the same tenant-wide `hashed_download_passcode` value, not a second
 * passcode to configure. logDownload() stays download-specific.
 *
 * Runs on the RLS-respecting client, not service-role: an export only
 * ever happens under a live authenticated session (unlike a failed
 * login, which has none), so download_audit's self-scoped INSERT policy
 * (migration 0018) is sufficient on its own.
 */
export class DownloadService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async verifyPasscode(tenantId: string, passcode: string): Promise<boolean> {
    const { data } = await this.supabase
      .from("tenant_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("setting_key", "hashed_download_passcode")
      .maybeSingle();

    const stored = typeof data?.value === "string" ? data.value : null;
    if (!stored) {
      return false;
    }

    return verifyPasscodeHash(passcode, stored);
  }

  async logDownload(input: {
    tenantId: string;
    profileId: string;
    exportType: string;
    entityRef: string | null;
    passcodeVerifiedAt: string | null;
    ip: string | null;
  }): Promise<void> {
    const { error } = await this.supabase.from("download_audit").insert({
      tenant_id: input.tenantId,
      profile_id: input.profileId,
      export_type: input.exportType,
      entity_ref: input.entityRef,
      passcode_verified_at: input.passcodeVerifiedAt,
      ip: input.ip,
    });

    if (error) {
      throw new Error(`DownloadService.logDownload: ${error.message}`);
    }
  }
}
