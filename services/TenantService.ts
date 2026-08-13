import type { SupabaseClient } from "@supabase/supabase-js";

import { RoleService } from "@/services/RoleService";
import type { Database } from "@/types/database.types";
import { randomSlugSuffix, slugify } from "@/lib/utils/slug";

/**
 * TenantService — tenant creation/onboarding, settings, config-cascade
 * resolution. See docs/04-multi-tenancy.md and docs/01-development-roadmap.md
 * Phase 1d.
 *
 * IMPORTANT: createTenant() runs its bootstrap sequence (tenant row +
 * owner tenant_membership + default roles + role_permissions + the
 * owner's user_role_assignment) using the SERVICE-ROLE client
 * (lib/supabase/service-role.ts), never the RLS-respecting server client.
 * A brand-new tenant has no role_permissions yet, so has_permission()
 * correctly denies the creating user everything until this seed sequence
 * completes — see the note at the top of
 * supabase/migrations/0001_core_tenancy_and_rbac.sql. The caller (the
 * sign-up server action) is responsible for constructing this service
 * with a service-role client, not an ordinary one.
 */
export interface CreateTenantInput {
  name: string;
  country: string;
  ownerProfileId: string;
  timezone?: string;
  defaultLocale?: string;
  currency?: string;
}

export interface CreatedTenant {
  tenantId: string;
  slug: string;
}

export class TenantService {
  private readonly roleService: RoleService;

  constructor(private readonly supabase: SupabaseClient<Database>) {
    this.roleService = new RoleService(supabase);
  }

  async createTenant(input: CreateTenantInput): Promise<CreatedTenant> {
    const slug = await this.generateUniqueSlug(input.name);

    const { data: tenant, error: tenantError } = await this.supabase
      .from("tenants")
      .insert({
        name: input.name,
        slug,
        country: input.country,
        timezone: input.timezone ?? "UTC",
        default_locale: input.defaultLocale ?? "en",
        currency: input.currency ?? "USD",
        billing_owner_profile_id: input.ownerProfileId,
      })
      .select("id, slug")
      .single();

    if (tenantError || !tenant) {
      throw new Error(
        `TenantService.createTenant: failed to create tenant: ${tenantError?.message}`
      );
    }

    const { data: membership, error: membershipError } = await this.supabase
      .from("tenant_memberships")
      .insert({
        tenant_id: tenant.id,
        profile_id: input.ownerProfileId,
        status: "active",
        joined_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (membershipError || !membership) {
      throw new Error(
        `TenantService.createTenant: failed to create owner membership: ${membershipError?.message}`
      );
    }

    const roles = await this.roleService.seedDefaultRoles(tenant.id);
    const adminRole = roles.find((r) => r.name === "Tenant Administrator");

    if (!adminRole) {
      throw new Error(
        "TenantService.createTenant: Tenant Administrator role was not seeded"
      );
    }

    const { error: assignmentError } = await this.supabase
      .from("user_role_assignments")
      .insert({
        tenant_id: tenant.id,
        tenant_membership_id: membership.id,
        role_id: adminRole.roleId,
        assigned_by: input.ownerProfileId,
      });

    if (assignmentError) {
      throw new Error(
        `TenantService.createTenant: failed to assign owner role: ${assignmentError.message}`
      );
    }

    return { tenantId: tenant.id, slug: tenant.slug };
  }

  async getSetting(_tenantId: string, _key: string): Promise<unknown> {
    throw new Error("TenantService.getSetting: not yet implemented (Phase 1d)");
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || "business";

    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${randomSlugSuffix()}`;

      const { data, error } = await this.supabase
        .from("tenants")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();

      if (error) {
        throw new Error(
          `TenantService.createTenant: failed to check slug availability: ${error.message}`
        );
      }

      if (!data) {
        return candidate;
      }
    }

    throw new Error(
      "TenantService.createTenant: could not generate a unique slug after 5 attempts"
    );
  }
}
