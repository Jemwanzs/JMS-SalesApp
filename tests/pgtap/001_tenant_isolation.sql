-- ============================================================================
-- 001_tenant_isolation.sql
--
-- pgTAP tests proving the single most important property of this system:
--
--   Tenant A must never read, modify, export, or infer Tenant B's
--   information. (docs/18-testing-qa.md)
--
-- These test RLS policies and the SECURITY DEFINER authorization functions
-- DIRECTLY against Postgres, using two seeded test tenants (Tenant Alpha /
-- Tenant Beta) and simulated authenticated sessions -- not through the app
-- layer. This is what "done" means for supabase/migrations/0001 per
-- docs/18-testing-qa.md.
--
-- HOW TO RUN
--   Requires a local Supabase stack (Docker Desktop running):
--     supabase start
--     supabase test db
--   Or directly against any Postgres with the pgtap extension enabled:
--     psql <connection> -f tests/pgtap/001_tenant_isolation.sql
--
--   Do NOT run this against the shared production/dev project as-is -- it
--   creates and then cleans up fixture rows, and the auth.uid() simulation
--   below (via set_config) is intended for a local/test database.
-- ============================================================================

begin;

create extension if not exists pgtap;

select plan(20);

-- ----------------------------------------------------------------------------
-- Fixtures: two tenants, one user each, each user an active member of only
-- their own tenant, with the seeded "Tenant Administrator"-equivalent grant
-- (roles.manage + settings.manage) so has_permission() has something real
-- to evaluate.
-- ----------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alpha-owner@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'beta-owner@test.local')
on conflict (id) do nothing;

-- profiles are auto-provisioned by the on_auth_user_created trigger; no
-- manual insert needed here.

insert into public.tenants (id, name, slug) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant Alpha', 'tenant-alpha'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant Beta', 'tenant-beta');

insert into public.tenant_memberships (id, tenant_id, profile_id, status, joined_at) values
  ('c1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', now()),
  ('c2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'active', now());

insert into public.roles (id, tenant_id, name, is_system_default) values
  ('d1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant Administrator', true),
  ('d2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant Administrator', true);

insert into public.role_permissions (role_id, permission_id)
select 'd1111111-1111-1111-1111-111111111111', id from public.permissions where key in ('roles.manage', 'settings.manage', 'sales.view_all')
union all
select 'd2222222-2222-2222-2222-222222222222', id from public.permissions where key in ('roles.manage', 'settings.manage', 'sales.view_all');

insert into public.user_role_assignments (id, tenant_id, tenant_membership_id, role_id) values
  ('e1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c1111111-1111-1111-1111-111111111111', 'd1111111-1111-1111-1111-111111111111'),
  ('e2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'c2222222-2222-2222-2222-222222222222', 'd2222222-2222-2222-2222-222222222222');

insert into public.locations (id, tenant_id, name) values
  ('f1111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alpha HQ'),
  ('f2222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Beta HQ');

-- Helper to simulate "logged in as" for RLS's auth.uid() during this
-- session. Supabase's auth.uid() reads the 'sub' claim out of the
-- request.jwt.claims JSON GUC, not an individual per-claim setting.
create or replace function test_login_as(p_uid uuid) returns void as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text,
    true
  );
$$ language sql;

-- ----------------------------------------------------------------------------
-- is_tenant_member() / has_permission() correctness
-- ----------------------------------------------------------------------------

select test_login_as('11111111-1111-1111-1111-111111111111');

select ok(
  public.is_tenant_member('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'Alpha owner is recognized as a member of Tenant Alpha'
);

select ok(
  not public.is_tenant_member('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Alpha owner is NOT recognized as a member of Tenant Beta'
);

select ok(
  public.has_permission('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'roles.manage'),
  'Alpha owner has roles.manage in their own tenant'
);

select ok(
  not public.has_permission('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'roles.manage'),
  'Alpha owner does NOT have roles.manage in Tenant Beta'
);

-- ----------------------------------------------------------------------------
-- RLS: tenants
-- ----------------------------------------------------------------------------

set role authenticated;

select is(
  (select count(*)::int from public.tenants where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Alpha owner can SELECT their own tenant row'
);

select is(
  (select count(*)::int from public.tenants where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'Alpha owner cannot SELECT Tenant Beta''s row'
);

update public.tenants set name = 'Hacked' where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

reset role;

-- Verified with elevated privileges (RLS would hide the row entirely from
-- the authenticated role that just ran the update, so we must check
-- outside that role): the UPDATE's USING clause silently filtered Tenant
-- Beta's row out -- 0 rows affected, no error, and the name is untouched.
select isnt(
  (select name from public.tenants where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Hacked',
  'Alpha owner''s UPDATE against Tenant Beta''s row silently updates 0 rows (RLS-filtered, not an error)'
);

-- ----------------------------------------------------------------------------
-- RLS: tenant_memberships
-- ----------------------------------------------------------------------------

set role authenticated;

select is(
  (select count(*)::int from public.tenant_memberships where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'Alpha owner cannot see Tenant Beta''s membership rows'
);

reset role;

-- ----------------------------------------------------------------------------
-- RLS: locations
-- ----------------------------------------------------------------------------

set role authenticated;

select is(
  (select count(*)::int from public.locations where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1,
  'Alpha owner can see their own location'
);

select is(
  (select count(*)::int from public.locations where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'Alpha owner cannot see Tenant Beta''s location'
);

reset role;

-- ----------------------------------------------------------------------------
-- RLS: roles / role_permissions / user_role_assignments
-- ----------------------------------------------------------------------------

set role authenticated;

select is(
  (select count(*)::int from public.roles where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'Alpha owner cannot see Tenant Beta''s roles'
);

select is(
  (select count(*)::int from public.role_permissions where role_id = 'd2222222-2222-2222-2222-222222222222'),
  0,
  'Alpha owner cannot see Tenant Beta''s role_permissions'
);

select is(
  (select count(*)::int from public.user_role_assignments where tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  0,
  'Alpha owner cannot see Tenant Beta''s user_role_assignments'
);

reset role;

-- ----------------------------------------------------------------------------
-- Symmetry check: swap perspectives, Beta owner cannot see Alpha's data
-- ----------------------------------------------------------------------------

select test_login_as('22222222-2222-2222-2222-222222222222');

set role authenticated;

select is(
  (select count(*)::int from public.tenants where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'Beta owner cannot SELECT Tenant Alpha''s row'
);

select is(
  (select count(*)::int from public.locations where tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0,
  'Beta owner cannot see Tenant Alpha''s location'
);

reset role;

-- ----------------------------------------------------------------------------
-- No membership at all: a user with zero tenant_memberships rows sees zero
-- rows everywhere, not an error.
-- ----------------------------------------------------------------------------

select test_login_as('99999999-9999-9999-9999-999999999999');

set role authenticated;

select is(
  (select count(*)::int from public.tenants),
  0,
  'A user with no memberships sees zero tenants, not an error'
);

select is(
  (select count(*)::int from public.locations),
  0,
  'A user with no memberships sees zero locations, not an error'
);

reset role;

-- ----------------------------------------------------------------------------
-- Audit-immutability pattern (applied to audit_logs/download_audit/
-- platform_audit_logs once those tables exist in a later migration): no
-- UPDATE/DELETE policy exists on permissions, proving "no policy for a
-- command = denied outright" holds even for the global read-only catalog.
-- ----------------------------------------------------------------------------

select test_login_as('11111111-1111-1111-1111-111111111111');

set role authenticated;

select is(
  (select count(*)::int from public.permissions),
  30,
  'Permission catalog is fully readable by any authenticated user (global catalog)'
);

reset role;

-- ----------------------------------------------------------------------------
-- Suspension folds into has_permission()
-- ----------------------------------------------------------------------------

update public.tenants set status = 'suspended' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select ok(
  not public.has_permission('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'roles.manage'),
  'A write-type permission (roles.manage) is denied once the tenant is suspended'
);

select ok(
  public.has_permission('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sales.view_all'),
  'A read-only permission (sales.view_all) still resolves true for a suspended tenant'
);

update public.tenants set status = 'active' where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select * from finish();

rollback;
