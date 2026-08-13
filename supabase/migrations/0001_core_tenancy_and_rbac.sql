-- ============================================================================
-- 0001_core_tenancy_and_rbac.sql
--
-- Core tenancy, membership, location, and RBAC schema for JMS Sales App.
-- This is the foundation every later migration builds on. See:
--   docs/03-database-schema.md   -- table catalog
--   docs/04-multi-tenancy.md     -- RLS strategy and rationale
--   docs/06-roles-permissions.md -- permission catalog and default roles
--
-- IMPORTANT bootstrap note for TenantService.createTenant:
-- A brand-new tenant has no role_permissions/user_role_assignments yet, so
-- has_permission() will correctly deny the creating user everything within
-- that tenant until roles are seeded and assigned. The onboarding flow that
-- creates a tenant, its owner membership, default roles, and the initial
-- role assignment must therefore run as one atomic sequence using the
-- service-role Supabase client (lib/supabase/service-role.ts), not the
-- RLS-respecting server client. Normal RLS-respecting flows take over for
-- every subsequent action once the owner has an active membership + role.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Shared helper: keep updated_at current on every UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. IDENTITY
-- ============================================================================

-- One row per human, independent of any tenant. Never attach application
-- data directly to auth.users -- this indirection is what lets one person
-- belong to multiple tenants (docs/04-multi-tenancy.md).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  email text not null,
  phone text,
  default_locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-provision a profile row whenever a new auth user is created, so
-- application code never has to (and can't forget to) create one manually.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ============================================================================
-- 2. TENANTS
-- ============================================================================

create type public.tenant_status as enum ('active', 'suspended', 'cancelled');

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status public.tenant_status not null default 'active',
  timezone text not null default 'UTC',
  default_locale text not null default 'en',
  currency text not null default 'USD',
  logo_url text,
  business_type text,
  website text,
  anniversary_date date,
  billing_owner_profile_id uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_tenants_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. MEMBERSHIP
-- ============================================================================

create type public.membership_status as enum ('active', 'invited', 'disabled');

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  status public.membership_status not null default 'invited',
  invited_by uuid references public.profiles (id),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, profile_id)
);

create index idx_tenant_memberships_tenant on public.tenant_memberships (tenant_id);
create index idx_tenant_memberships_profile on public.tenant_memberships (profile_id);

create trigger set_tenant_memberships_updated_at
before update on public.tenant_memberships
for each row execute function public.set_updated_at();

create table public.tenant_settings (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  setting_key text not null,
  value jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, setting_key)
);

-- ============================================================================
-- 4. LOCATIONS
-- ============================================================================

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  code text,
  address text,
  lat double precision,
  long double precision,
  geofence_radius_m integer,
  timezone text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_locations_tenant on public.locations (tenant_id);

create trigger set_locations_updated_at
before update on public.locations
for each row execute function public.set_updated_at();

create table public.location_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  open_time time,
  close_time time,
  closed_all_day boolean not null default false,
  unique (location_id, day_of_week)
);

create index idx_location_hours_tenant on public.location_hours (tenant_id);

create table public.special_hours (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  date date not null,
  is_closed boolean not null default false,
  open_time time,
  close_time time,
  reason text,
  unique (location_id, date)
);

create index idx_special_hours_tenant on public.special_hours (tenant_id);

-- ============================================================================
-- 5. RBAC
-- ============================================================================

-- Global permission catalog. is_read_only marks permissions that stay
-- granted even while a tenant is suspended (billing owner's read access),
-- so has_permission() can key off an explicit flag rather than pattern-
-- matching permission-key strings.
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  module text not null,
  description text,
  is_read_only boolean not null default false,
  created_at timestamptz not null default now()
);

-- Roles are PER-TENANT ROWS, not shared global templates -- default roles
-- are seeded as a tenant's own rows at tenant creation (TenantService),
-- so a tenant can freely edit its own grants. See docs/06-roles-permissions.md.
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  is_system_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

create index idx_roles_tenant on public.roles (tenant_id);

create trigger set_roles_updated_at
before update on public.roles
for each row execute function public.set_updated_at();

create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

-- location_id nullable: a role assignment can be tenant-wide or scoped to
-- one location (e.g. a Supervisor for a single branch).
create table public.user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  tenant_membership_id uuid not null references public.tenant_memberships (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete cascade,
  location_id uuid references public.locations (id) on delete cascade,
  assigned_by uuid references public.profiles (id),
  assigned_at timestamptz not null default now(),
  unique (tenant_membership_id, role_id, location_id)
);

create index idx_user_role_assignments_tenant on public.user_role_assignments (tenant_id);
create index idx_user_role_assignments_membership on public.user_role_assignments (tenant_membership_id);

-- ============================================================================
-- 6. AUTHORIZATION FUNCTIONS
--
-- The single source of truth for "can this user do X in tenant Y". Every
-- RLS policy in this and future migrations calls these rather than
-- querying membership/role tables inline -- this avoids RLS self-
-- recursion (a policy on tenant_memberships that queries
-- tenant_memberships to authorize itself) and keeps app-layer
-- authorization (lib/permissions/can.ts) from ever drifting out of sync
-- with what RLS actually enforces, since it calls these same functions.
--
-- search_path is pinned on every SECURITY DEFINER function below. This is
-- mandatory, not stylistic: an unpinned search_path in a SECURITY DEFINER
-- function is a known Postgres privilege-escalation vector.
-- ============================================================================

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
      and tm.profile_id = auth.uid()
      and tm.status = 'active'
  );
$$;

revoke execute on function public.is_tenant_member(uuid) from public;
grant execute on function public.is_tenant_member(uuid) to authenticated;

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
    -- Suspended tenants: only permissions explicitly marked read-only
    -- (billing owner's retained read access) resolve true. Centralized
    -- here so no individual feature needs its own suspension check.
    -- See docs/04-multi-tenancy.md.
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
        and tm.profile_id = auth.uid()
        and tm.status = 'active'
        and p.key = p_permission_key
        and (p_location_id is null or ura.location_id is null or ura.location_id = p_location_id)
    )
  end;
$$;

revoke execute on function public.has_permission(uuid, text, uuid) from public;
grant execute on function public.has_permission(uuid, text, uuid) to authenticated;

-- Resolved permission set for the caller in one tenant, used by
-- lib/permissions/can.ts to seed the request-scoped cache with a single
-- round trip instead of one has_permission() call per check.
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
    and tm.profile_id = auth.uid()
    and tm.status = 'active';
$$;

revoke execute on function public.get_my_permissions(uuid) from public;
grant execute on function public.get_my_permissions(uuid) to authenticated;

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.locations enable row level security;
alter table public.location_hours enable row level security;
alter table public.special_hours enable row level security;
alter table public.permissions enable row level security;
alter table public.roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_role_assignments enable row level security;

-- ---- profiles ----------------------------------------------------------
-- A user always sees their own profile, plus the basic profile info of
-- anyone who shares an active tenant with them (needed for user lists).
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.tenant_memberships mine
    join public.tenant_memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.profile_id = auth.uid()
      and mine.status = 'active'
      and theirs.profile_id = public.profiles.id
      and theirs.status = 'active'
  )
);

create policy profiles_update_own on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

-- No insert/delete policy for authenticated: profiles are only ever
-- created by the handle_new_auth_user trigger and deleted by cascade
-- from auth.users.

-- ---- tenants -------------------------------------------------------------
create policy tenants_select on public.tenants
for select to authenticated
using (public.is_tenant_member(id));

-- Any authenticated user may create a new tenant (self-service signup /
-- onboarding). TenantService enforces any additional business rules
-- (e.g. bootstrapping the owner membership + default roles) using the
-- service-role client immediately afterward -- see the note at the top
-- of this file.
create policy tenants_insert on public.tenants
for insert to authenticated
with check (auth.uid() is not null);

create policy tenants_update on public.tenants
for update to authenticated
using (public.has_permission(id, 'settings.manage'))
with check (public.has_permission(id, 'settings.manage'));

-- ---- tenant_memberships ---------------------------------------------------
-- A member sees their own membership row (even if invited/disabled) plus
-- every membership row in a tenant they're an active member of.
create policy tenant_memberships_select on public.tenant_memberships
for select to authenticated
using (
  profile_id = auth.uid()
  or public.is_tenant_member(tenant_id)
);

create policy tenant_memberships_insert on public.tenant_memberships
for insert to authenticated
with check (public.has_permission(tenant_id, 'users.create'));

create policy tenant_memberships_update on public.tenant_memberships
for update to authenticated
using (public.has_permission(tenant_id, 'users.edit'))
with check (public.has_permission(tenant_id, 'users.edit'));

-- No delete policy: users are disabled (status = 'disabled'), never
-- removed -- they must remain attached to historical sales/audit logs.

-- ---- tenant_settings -------------------------------------------------------
create policy tenant_settings_select on public.tenant_settings
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy tenant_settings_upsert on public.tenant_settings
for insert to authenticated
with check (public.has_permission(tenant_id, 'settings.manage'));

create policy tenant_settings_update on public.tenant_settings
for update to authenticated
using (public.has_permission(tenant_id, 'settings.manage'))
with check (public.has_permission(tenant_id, 'settings.manage'));

-- ---- locations / location_hours / special_hours ----------------------------
create policy locations_select on public.locations
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy locations_write on public.locations
for all to authenticated
using (public.has_permission(tenant_id, 'settings.manage'))
with check (public.has_permission(tenant_id, 'settings.manage'));

create policy location_hours_select on public.location_hours
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy location_hours_write on public.location_hours
for all to authenticated
using (public.has_permission(tenant_id, 'settings.manage'))
with check (public.has_permission(tenant_id, 'settings.manage'));

create policy special_hours_select on public.special_hours
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy special_hours_write on public.special_hours
for all to authenticated
using (public.has_permission(tenant_id, 'settings.manage'))
with check (public.has_permission(tenant_id, 'settings.manage'));

-- ---- permissions (global catalog) -----------------------------------------
create policy permissions_select on public.permissions
for select to authenticated
using (true);

-- No insert/update/delete policy for authenticated: the catalog is
-- maintained only via migrations/seeds under the service role.

-- ---- roles / role_permissions / user_role_assignments ----------------------
create policy roles_select on public.roles
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy roles_write on public.roles
for all to authenticated
using (public.has_permission(tenant_id, 'roles.manage'))
with check (public.has_permission(tenant_id, 'roles.manage'));

create policy role_permissions_select on public.role_permissions
for select to authenticated
using (
  exists (
    select 1 from public.roles r
    where r.id = role_permissions.role_id
      and public.is_tenant_member(r.tenant_id)
  )
);

create policy role_permissions_write on public.role_permissions
for all to authenticated
using (
  exists (
    select 1 from public.roles r
    where r.id = role_permissions.role_id
      and public.has_permission(r.tenant_id, 'roles.manage')
  )
)
with check (
  exists (
    select 1 from public.roles r
    where r.id = role_permissions.role_id
      and public.has_permission(r.tenant_id, 'roles.manage')
  )
);

create policy user_role_assignments_select on public.user_role_assignments
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy user_role_assignments_write on public.user_role_assignments
for all to authenticated
using (public.has_permission(tenant_id, 'roles.manage'))
with check (public.has_permission(tenant_id, 'roles.manage'));

-- ============================================================================
-- 8. PERMISSION CATALOG SEED
--
-- Reference data required for the app to function at all (not sample/demo
-- data -- that lives in supabase/seeds/). Matches docs/06-roles-permissions.md.
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('sales.create', 'sales', 'Record a new sale', false),
  ('sales.view_own', 'sales', 'View own recorded sales', true),
  ('sales.view_all', 'sales', 'View all sales for the tenant/location', true),
  ('sales.edit_window', 'sales', 'Edit own sale within the configured edit window', false),
  ('sales.correct_historical', 'sales', 'Correct a sale after the edit window has closed', false),
  ('sales.void', 'sales', 'Void a sale', false),

  ('analytics.view_own', 'analytics', 'View own analytics', true),
  ('analytics.view_all', 'analytics', 'View business-wide analytics', true),
  ('analytics.past_dates', 'analytics', 'View analytics for past dates', true),
  ('analytics.date_range', 'analytics', 'View analytics for a custom date range', true),
  ('analytics.all_users', 'analytics', 'View analytics broken down by all users', true),
  ('analytics.products', 'analytics', 'View product-level analytics', true),
  ('analytics.locations', 'analytics', 'View location-level analytics', true),

  ('products.view', 'products', 'View products', true),
  ('products.create', 'products', 'Create products', false),
  ('products.edit', 'products', 'Edit products', false),
  ('products.archive', 'products', 'Archive/inactivate products', false),

  ('reports.view', 'reports', 'View reports', true),
  ('reports.export', 'reports', 'Export reports', false),

  ('business_day.open', 'business_day', 'Manually open a business day', false),
  ('business_day.close', 'business_day', 'Manually/force close a business day', false),
  ('business_day.reopen', 'business_day', 'Reopen a closed business day', false),

  ('users.create', 'users', 'Create/invite users', false),
  ('users.edit', 'users', 'Edit users', false),
  ('users.disable', 'users', 'Disable users', false),

  ('roles.manage', 'roles', 'Manage roles and permission assignments', false),
  ('security.manage', 'security', 'Manage security centre settings', false),
  ('settings.manage', 'settings', 'Manage business workspace settings', false),

  ('billing.view', 'billing', 'View billing/subscription status', true),
  ('billing.manage', 'billing', 'Manage billing/subscription', false);
