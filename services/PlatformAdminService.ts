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

  async isPlatformAdmin(profileId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from("platform_admins")
      .select("id")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error) {
      throw new Error(`PlatformAdminService.isPlatformAdmin: ${error.message}`);
    }

    return Boolean(data);
  }

  /**
   * Foundation-level KPIs only (tenant/user counts) — the full Phase 7
   * dashboard (revenue, renewals, failed payments, usage analytics) needs
   * the billing tables Phase 6 introduces. Real counts now rather than
   * placeholders, since tenants/tenant_memberships already exist for real.
   */
  async getDashboardKpis(): Promise<{
    totalTenants: number;
    activeTenants: number;
    suspendedTenants: number;
    totalUsers: number;
  }> {
    const [
      { count: totalTenants },
      { count: activeTenants },
      { count: suspendedTenants },
      { count: totalUsers },
    ] = await Promise.all([
      this.supabase.from("tenants").select("id", { count: "exact", head: true }),
      this.supabase
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      this.supabase
        .from("tenants")
        .select("id", { count: "exact", head: true })
        .eq("status", "suspended"),
      this.supabase.from("profiles").select("id", { count: "exact", head: true }),
    ]);

    return {
      totalTenants: totalTenants ?? 0,
      activeTenants: activeTenants ?? 0,
      suspendedTenants: suspendedTenants ?? 0,
      totalUsers: totalUsers ?? 0,
    };
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
