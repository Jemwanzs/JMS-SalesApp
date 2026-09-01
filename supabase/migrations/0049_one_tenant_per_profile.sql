-- ============================================================================
-- 0049_one_tenant_per_profile.sql
--
-- Multi-Branch User Access, Phase 1: one email/profile can only ever
-- belong to ONE tenant at a time. tenant_memberships previously only
-- had `unique (tenant_id, profile_id)` -- that blocks a duplicate row
-- for the exact same tenant+profile pair, but nothing stopped one
-- profile from having membership rows in two DIFFERENT tenants
-- simultaneously.
--
-- "At a time", not "forever": a profile with its membership row fully
-- DELETED (removed from a tenant, or that tenant deleted) becomes free
-- to join a different tenant afterward. This constraint only blocks a
-- profile from holding a SECOND active/invited/disabled row while one
-- already exists elsewhere -- regardless of status, since a disabled
-- (not yet fully removed) member is still notionally "in" that tenant.
--
-- Safety-checked before writing this migration, not assumed: queried
-- every tenant_memberships row grouped by profile_id across the real
-- database -- 3 total rows, 3 distinct profiles, zero profiles with
-- more than one row. Nothing to reconcile.
-- ============================================================================

alter table public.tenant_memberships
  add constraint tenant_memberships_profile_id_key unique (profile_id);
