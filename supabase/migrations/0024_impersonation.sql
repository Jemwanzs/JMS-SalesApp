-- ============================================================================
-- 0024_impersonation.sql
--
-- Phase 7b (Platform Administration): "Access Workspace" impersonation
-- (docs/15-super-admin.md's "Impersonation" section): reason -> platform
-- MFA -> time-limited session -> immutable audit. Platform MFA reuses
-- Supabase Auth's own native TOTP MFA (the SAME supabase.auth.mfa.*
-- surface features/security/components/mfa-enrollment.tsx already uses
-- for tenant users) -- there is no separate platform-admin MFA system to
-- build; the app layer requires AAL2 before starting a session (see
-- features/platform-admin/actions/start-impersonation.ts), and this
-- migration only records that it happened (mfa_verified_at).
--
-- impersonation_sessions gets the same posture as platform_admins/
-- platform_audit_logs (migrations 0004/0022): RLS enabled, ZERO policies
-- for authenticated/anon -- reachable only via the service-role client
-- after PlatformAdminService's own app-layer checks.
--
-- The actual "access" mechanic: the platform admin's OWN Supabase Auth
-- session is used throughout -- there is no session-token swap to the
-- target user's real identity (safer custody-wise: nothing about the
-- target user's credentials/session is ever touched). Instead, the THREE
-- SQL functions that already centralize 100% of tenant-scoped RLS
-- (has_permission, is_tenant_member, get_my_permissions -- see 0001's own
-- header comment on why suspension enforcement lives in has_permission
-- alone rather than being re-derived per feature) are extended with one
-- new fallback: when the caller is a platform admin with an active,
-- non-expired impersonation_sessions row for that specific tenant, every
-- permission check resolves against the SESSION'S target_profile_id
-- instead of auth.uid() -- literally "exactly what that real employee
-- could do," never more, and automatically inherited by every tenant-
-- scoped table's policy without touching any of them individually (the
-- same "one centralized function" principle 0001 already established for
-- suspension). profiles_select (0001) is the one existing policy that
-- does NOT go through is_tenant_member() -- it inlines the equivalent
-- join directly -- so it's redefined here to call is_tenant_member()
-- instead, a strict widening (identical result for every real member,
-- now also correct under impersonation) that lets a platform admin see
-- who's who while impersonating.
--
-- Expiry and status are the actual security boundary (checked fresh on
-- every request via these SQL functions); the SUPPORT MODE banner and
-- its countdown (app/(tenant)/t/[tenantSlug]/layout.tsx) are a UX layer
-- on top, not the enforcement itself.
-- ============================================================================

create table public.impersonation_sessions (
  id uuid primary key default gen_random_uuid(),
  platform_admin_id uuid not null references public.platform_admins (id),
  target_tenant_id uuid not null references public.tenants (id) on delete cascade,
  target_profile_id uuid not null references public.profiles (id),
  reason text not null,
  mfa_verified_at timestamptz not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  banner_ack boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_impersonation_sessions_admin on public.impersonation_sessions (platform_admin_id, started_at desc);
create index idx_impersonation_sessions_active on public.impersonation_sessions (target_tenant_id, expires_at) where ended_at is null;

alter table public.impersonation_sessions enable row level security;
-- No policies -- service-role only, same as platform_admins/platform_audit_logs.

-- ----------------------------------------------------------------------------
-- Resolves to the impersonated target's profile id when the CALLER
-- (auth.uid()) is a platform admin currently running an active session
-- against p_tenant_id, else null. SECURITY DEFINER so it can read
-- platform_admins/impersonation_sessions despite both having zero RLS
-- policies for the authenticated role -- the exact same bypass pattern
-- has_permission/is_tenant_member already use to read tenant_memberships.
-- ----------------------------------------------------------------------------
create or replace function public.impersonated_profile_id(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.target_profile_id
  from public.impersonation_sessions s
  join public.platform_admins pa on pa.id = s.platform_admin_id
  where pa.profile_id = auth.uid()
    and s.target_tenant_id = p_tenant_id
    and s.ended_at is null
    and s.expires_at > now()
  order by s.started_at desc
  limit 1;
$$;

revoke execute on function public.impersonated_profile_id(uuid) from public;
grant execute on function public.impersonated_profile_id(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- is_tenant_member / has_permission / get_my_permissions: byte-identical
-- to their 0001 definitions except tm.profile_id = auth.uid() becomes
-- tm.profile_id = coalesce(impersonated_profile_id(p_tenant_id), auth.uid()).
-- For every caller who isn't an active-session platform admin,
-- impersonated_profile_id() returns null and coalesce falls through to
-- auth.uid() exactly as before -- zero behavior change for ordinary
-- traffic. Suspension enforcement (has_permission's own status check,
-- evaluated first) is untouched, so an impersonated SUSPENDED tenant
-- correctly still only exposes read-only permissions -- "see exactly
-- what the target user sees" includes seeing the suspension itself.
-- ----------------------------------------------------------------------------
create or replace function public.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.profile_id = coalesce(public.impersonated_profile_id(p_tenant_id), auth.uid())
      and tm.status = 'active'
  );
$$;

create or replace function public.has_permission(
  p_tenant_id uuid,
  p_permission_key text,
  p_location_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select t.status from public.tenants t where t.id = p_tenant_id) = 'suspended'
      and not coalesce((select p.is_read_only from public.permissions p where p.key = p_permission_key), false)
    then false
    else exists (
      select 1
      from public.tenant_memberships tm
      join public.user_role_assignments ura on ura.tenant_membership_id = tm.id
      join public.role_permissions rp on rp.role_id = ura.role_id
      join public.permissions p on p.id = rp.permission_id
      where tm.tenant_id = p_tenant_id
        and tm.profile_id = coalesce(public.impersonated_profile_id(p_tenant_id), auth.uid())
        and tm.status = 'active'
        and p.key = p_permission_key
        and (p_location_id is null or ura.location_id is null or ura.location_id = p_location_id)
    )
  end;
$$;

create or replace function public.get_my_permissions(p_tenant_id uuid)
returns table (permission_key text, location_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct p.key, ura.location_id
  from public.tenant_memberships tm
  join public.user_role_assignments ura on ura.tenant_membership_id = tm.id
  join public.role_permissions rp on rp.role_id = ura.role_id
  join public.permissions p on p.id = rp.permission_id
  where tm.tenant_id = p_tenant_id
    and tm.profile_id = coalesce(public.impersonated_profile_id(p_tenant_id), auth.uid())
    and tm.status = 'active';
$$;

-- profiles_select: redefined to route the "any tenant-mate's profile"
-- clause through is_tenant_member() instead of an inlined equivalent
-- join, so it automatically inherits the impersonation fallback above.
-- Strict widening only -- identical result for a real member either way.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.tenant_memberships theirs
    where theirs.profile_id = public.profiles.id
      and theirs.status = 'active'
      and public.is_tenant_member(theirs.tenant_id)
  )
);

-- ----------------------------------------------------------------------------
-- A handful of tables also grant a SELF-SCOPED read on top of their
-- has_permission()-gated base clause ("see my own X, or anything if I
-- hold the broader permission") -- own recorded sales, own submitted
-- approval/correction/temporary-access requests, own login/download
-- history, the tenant's billing owner. Each already inherited the
-- has_permission side of this fix automatically; the self-scoped
-- "= auth.uid()" half needs the identical coalesce() substitution so
-- impersonating a target user who does NOT hold the broader permission
-- still shows exactly what that target sees, not an empty page. WRITE-
-- side policies (sales_insert, download_audit_insert, etc.) are
-- deliberately left untouched -- a write performed while impersonating
-- should honestly record the real platform admin as the actor, never
-- the target, so those keep using auth.uid() as-is (same reasoning as
-- the v_actor := auth.uid() assignments inside approval/reopen
-- SECURITY DEFINER functions, none of which this migration touches).
-- ----------------------------------------------------------------------------
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
for select to authenticated
using (
  public.has_permission(tenant_id, 'sales.view_all')
  or (
    public.has_permission(tenant_id, 'sales.view_own')
    and recorded_by = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  )
);

drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests
for select to authenticated
using (
  requested_by = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  or public.has_permission(tenant_id, 'approvals.manage')
);

drop policy if exists sale_corrections_select on public.sale_corrections;
create policy sale_corrections_select on public.sale_corrections
for select to authenticated
using (
  public.has_permission(tenant_id, 'sales.view_all')
  or (
    public.has_permission(tenant_id, 'sales.view_own')
    and requested_by = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  )
);

drop policy if exists temporary_access_requests_select on public.temporary_access_requests;
create policy temporary_access_requests_select on public.temporary_access_requests
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  or public.has_permission(tenant_id, 'approvals.manage')
);

drop policy if exists download_audit_select on public.download_audit;
create policy download_audit_select on public.download_audit
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  or public.has_permission(tenant_id, 'security.manage')
);

-- tenant_id is nullable here (a pre-tenant-resolution FAILED_LOGIN has
-- none) -- impersonated_profile_id(null) safely returns null (the
-- equality it runs internally is against NULL, never true), so this
-- coalesce substitution is safe even for those rows, same as everywhere
-- else in this migration.
drop policy if exists login_events_select on public.login_events;
create policy login_events_select on public.login_events
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  or (tenant_id is not null and public.has_permission(tenant_id, 'security.manage'))
);

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  or (tenant_id is not null and public.has_permission(tenant_id, 'security.manage'))
);

drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id
      and t.billing_owner_profile_id = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id
      and t.billing_owner_profile_id = coalesce(public.impersonated_profile_id(tenant_id), auth.uid())
  )
  or public.has_permission(tenant_id, 'settings.manage')
);
