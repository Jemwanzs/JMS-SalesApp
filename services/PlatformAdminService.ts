import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * PlatformAdminService — tenant management, impersonation, platform
 * analytics. SERVICE-ROLE ONLY: platform_admins/platform_audit_logs/
 * impersonation_sessions are not reachable via normal RLS at all (see
 * docs/15-super-admin.md). Every method here writes a platform_audit_logs
 * row as part of the same operation — never as an optional afterthought,
 * and impersonation logging specifically is never configurable off.
 *
 * HARD RULE: this service never reads auth.* tables directly. Password-
 * reset/disable actions go exclusively through supabase.auth.admin.* SDK
 * calls under the service-role key. See
 * docs/05-authentication-security.md's password-visibility boundary.
 *
 * Not yet implemented — Phase 1g (foundation/guard), Phase 7 (full
 * feature set).
 */
export class PlatformAdminService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async isPlatformAdmin(_profileId: string): Promise<boolean> {
    throw new Error(
      "PlatformAdminService.isPlatformAdmin: not yet implemented (Phase 1g)"
    );
  }

  async startImpersonation(_input: {
    platformAdminId: string;
    targetTenantId: string;
    targetProfileId: string;
    reason: string;
    durationMinutes: number;
  }) {
    throw new Error(
      "PlatformAdminService.startImpersonation: not yet implemented (Phase 7b)"
    );
  }
}
