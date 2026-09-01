import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";

/**
 * LocationService — branch/location CRUD. Multi-Branch User Access
 * Phase 2 (docs pending; see .claude/plans, this session's plan for the
 * full six-phase design). The `locations` table itself, its RLS
 * (`locations_write`, gated on settings.manage), and `location_hours`/
 * `special_hours` all already existed (migration 0001) -- nothing here
 * is new schema, this is the CRUD surface the app never had beyond
 * TenantService's own `upsertPrimaryLocation` (onboarding's one-time,
 * upsert-keyed-on-existence "the tenant's first location" helper,
 * structurally incapable of ever creating a second row). This service
 * is for the *second* branch onward.
 *
 * Every method here runs through the RLS-respecting client on behalf
 * of a signed-in Tenant Administrator -- `locations_write` already
 * gates all of it on settings.manage; the explicit tenant_id filters
 * below are defense in depth for a clear error message, same pattern
 * as RoleService's own header comment describes for that service.
 *
 * Locations are never hard-deleted here -- sales/business_days/
 * sale_number_sequences all reference location_id with `on delete
 * cascade`, so deleting a location would destroy its entire sales
 * history. `deactivateLocation`/`reactivateLocation` (a status flip)
 * is the only removal path, matching the same soft-disable discipline
 * `PlatformAdminService.deactivateTenant` already uses at the tenant
 * level.
 */
export interface LocationSummary {
  id: string;
  name: string;
  code: string | null;
  address: string | null;
  status: string;
}

export class LocationService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async listLocations(tenantId: string): Promise<LocationSummary[]> {
    const { data, error } = await this.supabase
      .from("locations")
      .select("id, name, code, address, status")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(`LocationService.listLocations: ${error.message}`);
    }

    return data ?? [];
  }

  async createLocation(
    tenantId: string,
    input: { name: string; address?: string | null; code?: string | null; timezone?: string | null }
  ): Promise<{ locationId: string }> {
    const { data, error } = await this.supabase
      .from("locations")
      .insert({
        tenant_id: tenantId,
        name: input.name,
        address: input.address ?? null,
        code: input.code ?? null,
        timezone: input.timezone ?? null,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(`LocationService.createLocation: ${error?.message}`);
    }

    return { locationId: data.id };
  }

  async updateLocation(
    tenantId: string,
    locationId: string,
    input: { name?: string; address?: string | null; code?: string | null }
  ): Promise<void> {
    const { error } = await this.supabase
      .from("locations")
      .update(input)
      .eq("id", locationId)
      .eq("tenant_id", tenantId);

    if (error) {
      throw new Error(`LocationService.updateLocation: ${error.message}`);
    }
  }

  async deactivateLocation(tenantId: string, locationId: string): Promise<void> {
    const { error } = await this.supabase
      .from("locations")
      .update({ status: "inactive" })
      .eq("id", locationId)
      .eq("tenant_id", tenantId);

    if (error) {
      throw new Error(`LocationService.deactivateLocation: ${error.message}`);
    }
  }

  async reactivateLocation(tenantId: string, locationId: string): Promise<void> {
    const { error } = await this.supabase
      .from("locations")
      .update({ status: "active" })
      .eq("id", locationId)
      .eq("tenant_id", tenantId);

    if (error) {
      throw new Error(`LocationService.reactivateLocation: ${error.message}`);
    }
  }
}
