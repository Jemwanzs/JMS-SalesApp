-- ============================================================================
-- 0005_platform_admin_foundation.sql
--
-- Phase 1g: the platform_admins table itself. See docs/15-super-admin.md.
--
-- Deliberately NOT reachable through the normal authenticated RLS surface
-- at all: RLS is enabled with NO policies for the authenticated/anon
-- roles, which denies all access to them outright. The service-role key
-- bypasses RLS entirely (Supabase's standard behavior), so
-- PlatformAdminService (constructed with lib/supabase/service-role.ts)
-- is the only code path that can ever read or write this table. A
-- compromised tenant-side session can never enumerate platform admins,
-- regardless of any RLS policy bug elsewhere in the schema.
--
-- platform_audit_logs and impersonation_sessions (also part of the
-- Platform Admin domain per docs/03-database-schema.md) are deliberately
-- NOT created yet -- they belong to the actual impersonation feature in
-- Phase 7, not this foundation migration. No empty, unused tables.
-- ============================================================================

create type public.platform_admin_role as enum ('super_admin', 'support', 'billing_ops');

create table public.platform_admins (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id),
  role public.platform_admin_role not null default 'super_admin',
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
-- No policies: authenticated and anon get zero access. Only the
-- service-role key (which bypasses RLS) can read/write this table.
