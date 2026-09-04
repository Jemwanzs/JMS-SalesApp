import type { SupabaseClient } from "@supabase/supabase-js";

import { AuditService } from "@/services/AuditService";
import { BillingService } from "@/services/BillingService";
import { RoleService } from "@/services/RoleService";
import type { Database } from "@/types/database.types";
import { AUDIT_ACTION } from "@/lib/audit/actions";
import { assertNotPlatformOwnerTenant } from "@/lib/tenant/assert-not-platform-owner";
import { hashPasscode } from "@/lib/utils/passcode";
import { randomSlugSuffix, slugify } from "@/lib/utils/slug";

/**
 * TenantService — tenant creation/onboarding, settings, config-cascade
 * resolution. See docs/04-multi-tenancy.md and docs/01-development-roadmap.md
 * Phase 1d.
 *
 * IMPORTANT: createTenant() runs its bootstrap sequence (tenant row +
 * owner tenant_membership + default roles + role_permissions + the
 * owner's user_role_assignment + a TRIAL subscription row, Phase 6)
 * using the SERVICE-ROLE client (lib/supabase/service-role.ts), never
 * the RLS-respecting server client.
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
  private readonly billingService: BillingService;

  constructor(private readonly supabase: SupabaseClient<Database>) {
    this.roleService = new RoleService(supabase);
    this.billingService = new BillingService(supabase);
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

    await this.billingService.bootstrapTrialSubscription(tenant.id);

    return { tenantId: tenant.id, slug: tenant.slug };
  }

  /**
   * `tenant_settings` (migration 0001) is a generic per-tenant key/value
   * jsonb table -- a missing row just means "not configured," not an
   * error, so callers get `null` rather than having to special-case a
   * PostgREST not-found response.
   */
  async getSetting<T = unknown>(tenantId: string, key: string): Promise<T | null> {
    const { data, error } = await this.supabase
      .from("tenant_settings")
      .select("value")
      .eq("tenant_id", tenantId)
      .eq("setting_key", key)
      .maybeSingle();

    if (error) {
      throw new Error(`TenantService.getSetting: ${error.message}`);
    }

    return (data?.value as T | undefined) ?? null;
  }

  /**
   * Same as getSetting, but for several keys in one round trip instead
   * of one query per key -- performance audit finding: the Capture
   * Sales landing page alone fetches 4 separate settings this way on
   * every single page load (product_ranking_enabled, show_daily_sales_
   * volume, show_product_price_on_landing, quantity_enabled), and
   * Settings/Security do similarly. Missing keys are simply absent from
   * the returned map (same "no row = not configured" contract as
   * getSetting, just without a per-key null placeholder to check).
   */
  async getSettings(tenantId: string, keys: string[]): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase
      .from("tenant_settings")
      .select("setting_key, value")
      .eq("tenant_id", tenantId)
      .in("setting_key", keys);

    if (error) {
      throw new Error(`TenantService.getSettings: ${error.message}`);
    }

    const result: Record<string, unknown> = {};
    for (const row of data ?? []) {
      result[row.setting_key] = row.value;
    }
    return result;
  }

  /**
   * RLS (tenant_settings_upsert/update, migration 0001) gates this on
   * settings.manage -- callers should check that first for a clear error
   * rather than relying solely on the RLS rejection.
   */
  async setSetting(tenantId: string, key: string, value: unknown, updatedBy: string): Promise<void> {
    const { error } = await this.supabase
      .from("tenant_settings")
      .upsert(
        { tenant_id: tenantId, setting_key: key, value, updated_by: updatedBy },
        { onConflict: "tenant_id,setting_key" }
      );

    if (error) {
      throw new Error(`TenantService.setSetting: ${error.message}`);
    }
  }

  /**
   * docs/05's `hashed_download_passcode` -- never store the raw
   * passcode, only the scrypt hash, same as every other secret in this
   * app. A thin wrapper around setSetting so callers never handle the
   * plaintext passcode past this one call.
   */
  async setDownloadPasscode(tenantId: string, passcode: string, updatedBy: string): Promise<void> {
    await this.setSetting(tenantId, "hashed_download_passcode", hashPasscode(passcode), updatedBy);
  }

  /**
   * Onboarding wizard Step 1 (spec S10). Runs on the RLS-respecting
   * client — unlike createTenant's bootstrap, the caller here already
   * holds settings.manage via their Tenant Administrator role, so no
   * service-role escape hatch is needed.
   */
  async updateBusinessDetails(
    tenantId: string,
    input: {
      /** Optional: onboarding's own Step 1 caller never passes this (the name is already known from sign-up) -- only the post-onboarding Workspace edit does, where it's a real editable field alongside the rest. */
      name?: string;
      businessType: string;
      website: string | null;
      anniversaryDate: string | null;
      currency: string;
      timezone: string;
    }
  ): Promise<void> {
    const { error } = await this.supabase
      .from("tenants")
      .update({
        ...(input.name !== undefined ? { name: input.name } : {}),
        business_type: input.businessType,
        website: input.website,
        anniversary_date: input.anniversaryDate,
        currency: input.currency,
        timezone: input.timezone,
      })
      .eq("id", tenantId);

    if (error) {
      throw new Error(
        `TenantService.updateBusinessDetails: ${error.message}`
      );
    }
  }

  /**
   * User & Tenant Branding Personalization: sets (or replaces) a
   * tenant's logo. Mirrors ProductService.setImage/removeImage's shape
   * (delete the previous Storage object first, so a replace never
   * orphans it) but without a product_images-style side table -- a
   * tenant has exactly one current logo, never a gallery/history, so
   * the two columns directly on `tenants` are the right-sized version
   * of that pattern, not an under-build.
   */
  async setLogo(tenantId: string, storagePath: string, publicUrl: string): Promise<void> {
    await this.deletePreviousLogo(tenantId);

    const { error } = await this.supabase
      .from("tenants")
      .update({ logo_url: publicUrl, logo_storage_path: storagePath })
      .eq("id", tenantId);

    if (error) {
      throw new Error(`TenantService.setLogo: ${error.message}`);
    }
  }

  async removeLogo(tenantId: string): Promise<void> {
    await this.deletePreviousLogo(tenantId);

    const { error } = await this.supabase
      .from("tenants")
      .update({ logo_url: null, logo_storage_path: null })
      .eq("id", tenantId);

    if (error) {
      throw new Error(`TenantService.removeLogo: ${error.message}`);
    }
  }

  private async deletePreviousLogo(tenantId: string): Promise<void> {
    const { data: existing } = await this.supabase.from("tenants").select("logo_storage_path").eq("id", tenantId).maybeSingle();

    if (!existing?.logo_storage_path) {
      return;
    }

    const { error } = await this.supabase.storage.from("tenant-branding").remove([existing.logo_storage_path]);

    if (error) {
      throw new Error(`TenantService.deletePreviousLogo: ${error.message}`);
    }
  }

  /**
   * The primary location's own identifying fields -- separate from
   * getPrimaryLocationGeofence (different concern, Security page vs
   * Workspace page) even though both re-resolve "the tenant's first
   * location" the same way upsertPrimaryLocation does.
   */
  async getPrimaryLocation(tenantId: string): Promise<{ id: string; name: string; address: string | null } | null> {
    const { data } = await this.supabase
      .from("locations")
      .select("id, name, address")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    return data ?? null;
  }

  /**
   * Read counterpart to setLocationHours -- the onboarding wizard only
   * ever wrote this grid, nothing read it back until the post-
   * onboarding Workspace edit page needed to pre-fill the form with
   * what's actually saved. Days with no row yet (a tenant who finished
   * onboarding before this table existed, or skipped Step 2 via
   * ComingLaterStep) fall back to the same defaults LocationHoursStep
   * itself starts a brand-new tenant with, so the edit form is never
   * blank/inconsistent.
   */
  async getLocationHours(
    tenantId: string,
    locationId: string
  ): Promise<{ dayOfWeek: number; openTime: string; closeTime: string; closedAllDay: boolean }[]> {
    const { data } = await this.supabase
      .from("location_hours")
      .select("day_of_week, open_time, close_time, closed_all_day")
      .eq("tenant_id", tenantId)
      .eq("location_id", locationId);

    const byDay = new Map((data ?? []).map((row) => [row.day_of_week, row]));

    return Array.from({ length: 7 }, (_, dayOfWeek) => {
      const row = byDay.get(dayOfWeek);
      return {
        dayOfWeek,
        openTime: row?.open_time ?? "08:00",
        closeTime: row?.close_time ?? "17:00",
        closedAllDay: row?.closed_all_day ?? dayOfWeek === 0,
      };
    });
  }

  /**
   * Onboarding wizard Step 2 (spec S10): creates the tenant's first
   * location if one doesn't exist yet, or updates it if it does — Phase
   * 1 is single-location per tenant in practice even though the schema
   * supports many (docs/04-multi-tenancy.md), so "the primary location"
   * is a safe simplification for the wizard specifically.
   */
  async upsertPrimaryLocation(
    tenantId: string,
    input: { name: string; address: string }
  ): Promise<{ locationId: string }> {
    const { data: existing } = await this.supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error } = await this.supabase
        .from("locations")
        .update({ name: input.name, address: input.address })
        .eq("id", existing.id);

      if (error) {
        throw new Error(`TenantService.upsertPrimaryLocation: ${error.message}`);
      }

      return { locationId: existing.id };
    }

    const { data: created, error } = await this.supabase
      .from("locations")
      .insert({ tenant_id: tenantId, name: input.name, address: input.address })
      .select("id")
      .single();

    if (error || !created) {
      throw new Error(
        `TenantService.upsertPrimaryLocation: ${error?.message}`
      );
    }

    return { locationId: created.id };
  }

  /**
   * Phase 4 geo-fencing config -- same one-location-per-tenant
   * simplification as upsertPrimaryLocation. Distinct from that method
   * (rather than folding lat/long/radius into it) because this is
   * reachable post-onboarding, from the Security page, not the one-time
   * wizard, and null clears the fence rather than requiring all three
   * fields together.
   */
  async setLocationGeofence(
    tenantId: string,
    input: { latitude: number | null; longitude: number | null; radiusMeters: number | null }
  ): Promise<void> {
    const { data: location } = await this.supabase
      .from("locations")
      .select("id")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!location) {
      throw new Error("TenantService.setLocationGeofence: tenant has no location yet");
    }

    const { error } = await this.supabase
      .from("locations")
      .update({ lat: input.latitude, long: input.longitude, geofence_radius_m: input.radiusMeters })
      .eq("id", location.id);

    if (error) {
      throw new Error(`TenantService.setLocationGeofence: ${error.message}`);
    }
  }

  async getPrimaryLocationGeofence(
    tenantId: string
  ): Promise<{ latitude: number | null; longitude: number | null; radiusMeters: number | null } | null> {
    const { data: location } = await this.supabase
      .from("locations")
      .select("lat, long, geofence_radius_m")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!location) {
      return null;
    }

    return {
      latitude: location.lat,
      longitude: location.long,
      radiusMeters: location.geofence_radius_m,
    };
  }

  /**
   * Onboarding wizard Step 2's hours grid — replaces all 7 rows.
   * `locationId` is a plain caller-supplied argument (unlike
   * upsertPrimaryLocation/setLocationGeofence, which always look up the
   * tenant's own location themselves) -- a security sweep flagged that
   * location_hours' own RLS write policy only checks the INSERTED row's
   * `tenant_id`, not that `location_id` actually belongs to it, so a
   * mismatched pair would pass RLS. Verifying it here closes that gap at
   * the one place it could matter, even though today's only caller
   * (features/onboarding/actions/save-location-hours.ts) always passes
   * an id it just got back from upsertPrimaryLocation.
   */
  async setLocationHours(
    tenantId: string,
    locationId: string,
    hours: {
      dayOfWeek: number;
      openTime: string;
      closeTime: string;
      closedAllDay: boolean;
    }[]
  ): Promise<void> {
    const { data: location } = await this.supabase
      .from("locations")
      .select("id")
      .eq("id", locationId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!location) {
      throw new Error("TenantService.setLocationHours: location not found for this tenant");
    }

    const { error: deleteError } = await this.supabase
      .from("location_hours")
      .delete()
      .eq("location_id", locationId)
      .eq("tenant_id", tenantId);

    if (deleteError) {
      throw new Error(`TenantService.setLocationHours: ${deleteError.message}`);
    }

    const { error: insertError } = await this.supabase
      .from("location_hours")
      .insert(
        hours.map((h) => ({
          tenant_id: tenantId,
          location_id: locationId,
          day_of_week: h.dayOfWeek,
          open_time: h.closedAllDay ? null : h.openTime,
          close_time: h.closedAllDay ? null : h.closeTime,
          closed_all_day: h.closedAllDay,
        }))
      );

    if (insertError) {
      throw new Error(`TenantService.setLocationHours: ${insertError.message}`);
    }
  }

  /**
   * Account Deletion (Feature 1) -- a Tenant Administrator's self-
   * service "delete my business" request. Same shape as
   * PlatformAdminService.deactivateTenant/reactivateTenant (before-
   * select -> update -> AuditService.log), constructed with the
   * SERVICE-ROLE client by the caller (features/settings/actions/
   * request-tenant-deletion.ts) -- not because this write couldn't pass
   * RLS at request time (tenants_update just needs settings.manage,
   * which the action already asserts first), but so requestDeletion and
   * cancelDeletion share one consistent client strategy: cancelDeletion
   * genuinely cannot go through RLS (see its own comment below), and
   * splitting one small feature across two different client strategies
   * depending on which half of it you're looking at isn't worth it.
   *
   * Logs to the TENANT-scoped audit_logs (AuditService), not
   * PlatformAdminService's platform_audit_logs -- this is tenant-
   * initiated, not a platform-admin action.
   */
  async requestDeletion(tenantId: string, requestedBy: string): Promise<void> {
    await assertNotPlatformOwnerTenant(this.supabase, tenantId, "delete");

    const { data: before } = await this.supabase.from("tenants").select("status").eq("id", tenantId).single();

    const { error } = await this.supabase
      .from("tenants")
      .update({ status: "deactivated", deletion_requested_at: new Date().toISOString(), deletion_requested_by: requestedBy })
      .eq("id", tenantId);

    if (error) {
      throw new Error(`TenantService.requestDeletion: ${error.message}`);
    }

    await new AuditService(this.supabase)
      .log({
        tenantId,
        actorProfileId: requestedBy,
        action: AUDIT_ACTION.TENANT_DELETION_REQUESTED,
        entityType: "tenant",
        entityId: tenantId,
        oldValues: before,
        newValues: { status: "deactivated" },
        reason: "Self-service business deletion requested",
      })
      .catch(() => {});
  }

  /**
   * Structurally cannot be an RLS-respecting write: has_permission()
   * (migration 0031) returns zero permissions unconditionally for a
   * deactivated tenant -- tenants_update RLS would reject EVERY caller
   * here, including the requester, once status='deactivated' has
   * already taken effect. `deletion_requested_by === callerId` is the
   * only viable authorization signal left at that point (a different
   * Tenant Administrator, even one who'd normally hold settings.manage,
   * cannot cancel someone else's request this way -- contact support,
   * matching platform-admin's own reactivateTenant as the fallback).
   */
  async cancelDeletion(tenantId: string, callerId: string): Promise<void> {
    const { data: tenant, error: fetchError } = await this.supabase
      .from("tenants")
      .select("status, deletion_requested_by")
      .eq("id", tenantId)
      .single();

    if (fetchError || !tenant) {
      throw new Error("TenantService.cancelDeletion: tenant not found");
    }
    if (tenant.deletion_requested_by !== callerId) {
      throw new Error("TenantService.cancelDeletion: only the person who requested deletion can cancel it");
    }

    const { error } = await this.supabase
      .from("tenants")
      .update({ status: "active", deletion_requested_at: null, deletion_requested_by: null })
      .eq("id", tenantId);

    if (error) {
      throw new Error(`TenantService.cancelDeletion: ${error.message}`);
    }

    await new AuditService(this.supabase)
      .log({
        tenantId,
        actorProfileId: callerId,
        action: AUDIT_ACTION.TENANT_DELETION_CANCELLED,
        entityType: "tenant",
        entityId: tenantId,
        oldValues: { status: tenant.status },
        newValues: { status: "active" },
        reason: "Deletion request cancelled within the grace period",
      })
      .catch(() => {});
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
