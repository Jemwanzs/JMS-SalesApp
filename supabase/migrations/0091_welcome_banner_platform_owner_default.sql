-- ============================================================================
-- 0091_welcome_banner_platform_owner_default.sql
--
-- FEATURE ENHANCEMENT — TENANT-CONTROLLED LOGIN WELCOME BANNER.
--
-- No DDL: `show_welcome_banner` is a plain tenant_settings key (schema-
-- less jsonb, migration 0001) -- no new column/table/RLS needed. Any
-- tenant member can already READ any tenant_settings key (existing
-- `tenant_settings_select` policy); only `settings.manage` can WRITE
-- via the RLS-respecting client. Every read site defaults to
-- `?? false` for a not-yet-configured tenant (the established
-- convention every other ~20 toggles in this app already use), so
-- "off for new/self-signup tenants" needs no seeding at all.
--
-- The ONE thing that genuinely needs a real data change: the spec
-- requires this ON by default for the Platform Owner's own tenant.
-- There is no `tenants.is_platform_owner` column or any tenant-
-- creation-time hook to special-case that tenant (it's identified
-- dynamically elsewhere via `billing_owner_profile_id` -> a
-- `platform_admins` row, e.g. PlatformAdminService.getTenantDetail's
-- `isPlatformOwner`) -- so this is a one-time, idempotent data fix
-- targeting whichever tenant that resolves to, done as a real
-- migration (not a seed file, which never re-runs against an already-
-- provisioned production database) so it actually reaches the live
-- Platform Owner tenant when applied.
-- ============================================================================

insert into public.tenant_settings (tenant_id, setting_key, value, updated_by)
select t.id, 'show_welcome_banner', 'true'::jsonb, t.billing_owner_profile_id
from public.tenants t
where t.billing_owner_profile_id in (select profile_id from public.platform_admins)
on conflict (tenant_id, setting_key) do update set value = excluded.value, updated_by = excluded.updated_by;
