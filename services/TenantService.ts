import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * TenantService — tenant creation/onboarding, settings, config-cascade
 * resolution. See docs/04-multi-tenancy.md and docs/01-development-roadmap.md
 * Phase 1d.
 *
 * IMPORTANT: createTenant() must run its bootstrap sequence (tenant row +
 * owner tenant_membership + default roles + role_permissions + the
 * owner's user_role_assignment) using the SERVICE-ROLE client
 * (lib/supabase/service-role.ts), not the RLS-respecting server client.
 * A brand-new tenant has no role_permissions yet, so has_permission()
 * correctly denies the creating user everything until that seed sequence
 * completes — see the note at the top of
 * supabase/migrations/0001_core_tenancy_and_rbac.sql.
 *
 * Not yet implemented — Phase 1d.
 */
export interface CreateTenantInput {
  name: string;
  slug: string;
  ownerProfileId: string;
  timezone: string;
  defaultLocale: string;
  currency: string;
}

export class TenantService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async createTenant(_input: CreateTenantInput): Promise<{ tenantId: string }> {
    throw new Error("TenantService.createTenant: not yet implemented (Phase 1d)");
  }

  async getSetting(_tenantId: string, _key: string): Promise<unknown> {
    throw new Error("TenantService.getSetting: not yet implemented (Phase 1d)");
  }
}
