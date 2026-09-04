-- ============================================================================
-- 0066_supabase_advisor_safe_fixes.sql
--
-- Safe fixes from the Supabase Security/Performance Advisor review
-- (1 critical error, 54 warnings). Every item here was individually
-- verified by reading the cumulative final state of the relevant
-- migrations/functions/policies before being changed -- nothing here
-- weakens RLS or exposes a SECURITY DEFINER function more broadly.
-- Items deliberately NOT touched here (with reasoning) are documented
-- in the accompanying report to the user, not in this file.
--
-- ----------------------------------------------------------------------------
-- 1. CRITICAL -- Security Definer View: public.stock_balances
--
-- 0035's own header comment claimed views default to security_invoker
-- and therefore transparently inherit stock_movements' RLS. That is
-- backwards: Postgres views default to security_invoker = FALSE, so
-- this view has always evaluated stock_movements_select AS THE VIEW
-- OWNER (the migration-runner role, which bypasses RLS), not as the
-- querying user -- any authenticated caller could read every tenant's
-- stock balances through this view. Flipping the flag makes the
-- view's already-documented INTENDED behavior (inherit the base
-- table's RLS) actually true. No code anywhere queries this view
-- expecting cross-tenant rows, so this is a pure fix, not a behavior
-- change for any legitimate caller.
-- ----------------------------------------------------------------------------

alter view public.stock_balances set (security_invoker = true);

-- ----------------------------------------------------------------------------
-- 2. Function Search Path Mutable: public.set_updated_at()
--
-- The one function in the schema with no explicit search_path. It's a
-- SECURITY INVOKER trigger function (low practical risk), but pinning
-- it costs nothing and closes the warning. Body is byte-identical to
-- 0001's original -- only the search_path clause is new.
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Public Can Execute SECURITY DEFINER function -- real gaps only
--
-- update_teammate_name already has `grant ... to authenticated`
-- (0033) but was never revoked from PUBLIC, so both still had execute.
-- current_active_location (0050) never had any revoke/grant at all,
-- so it also still carries the implicit PUBLIC execute every function
-- gets on creation. Both are re-derived-check SECURITY DEFINER
-- functions with no legitimate reason for anon/public callers.
-- ----------------------------------------------------------------------------

revoke execute on function public.update_teammate_name(uuid, text) from public;

revoke execute on function public.current_active_location(uuid) from public;
grant execute on function public.current_active_location(uuid) to authenticated;

-- Trigger-only functions: Postgres already refuses any direct
-- SELECT/RPC call on these ("trigger functions can only be called as
-- triggers"), and firing a trigger does not go through the EXECUTE
-- privilege system at all -- so revoking public/authenticated execute
-- here is a zero-risk warning cleanup, not a functional change.
revoke execute on function public.handle_new_auth_user() from public, authenticated;
revoke execute on function public.assign_sale_number() from public, authenticated;
revoke execute on function public.enforce_role_assignment_tenant_match() from public, authenticated;
revoke execute on function public.enforce_platform_owner_tenant_active() from public, authenticated;
revoke execute on function public.enforce_platform_owner_tenant_no_delete() from public, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Auth RLS Initialization Plan -- wrap auth.uid()/auth.jwt() so
--    Postgres evaluates them once per query (initplan) instead of once
--    per row. Every policy below is reproduced from its current final
--    definition with ONLY the auth.*() calls rewritten as
--    (select auth.*()) -- no other clause, join, or permission check
--    is altered. drop+recreate is required (policies can't be ALTERed
--    in place); each pair is adjacent so the no-op window is a single
--    statement.
-- ----------------------------------------------------------------------------

-- profiles_select (final form: 0024)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.tenant_memberships theirs
    where theirs.profile_id = public.profiles.id
      and theirs.status = 'active'
      and public.is_tenant_member(theirs.tenant_id)
  )
);

-- profiles_update_own (0001, never redefined)
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- tenants_insert (0001, never redefined)
drop policy if exists tenants_insert on public.tenants;
create policy tenants_insert on public.tenants
for insert to authenticated
with check ((select auth.uid()) is not null);

-- tenant_memberships_select (0001, never redefined)
drop policy if exists tenant_memberships_select on public.tenant_memberships;
create policy tenant_memberships_select on public.tenant_memberships
for select to authenticated
using (
  profile_id = (select auth.uid())
  or public.is_tenant_member(tenant_id)
);

-- login_events_select (final form: 0024)
drop policy if exists login_events_select on public.login_events;
create policy login_events_select on public.login_events
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  or (tenant_id is not null and public.has_permission(tenant_id, 'security.manage'))
);

-- sessions_select (final form: 0024)
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  or (tenant_id is not null and public.has_permission(tenant_id, 'security.manage'))
);

-- temporary_access_requests_select (final form: 0024)
drop policy if exists temporary_access_requests_select on public.temporary_access_requests;
create policy temporary_access_requests_select on public.temporary_access_requests
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  or public.has_permission(tenant_id, 'approvals.manage')
);

-- download_audit_select (final form: 0024)
drop policy if exists download_audit_select on public.download_audit;
create policy download_audit_select on public.download_audit
for select to authenticated
using (
  profile_id = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  or public.has_permission(tenant_id, 'security.manage')
);

-- download_audit_insert (0018, never redefined)
drop policy if exists download_audit_insert on public.download_audit;
create policy download_audit_insert on public.download_audit
for insert to authenticated
with check (
  profile_id = (select auth.uid())
  and public.is_tenant_member(tenant_id)
);

-- approval_requests_select (final form: 0024)
drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests
for select to authenticated
using (
  requested_by = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  or public.has_permission(tenant_id, 'approvals.manage')
);

-- sale_corrections_select (final form: 0024)
drop policy if exists sale_corrections_select on public.sale_corrections;
create policy sale_corrections_select on public.sale_corrections
for select to authenticated
using (
  public.has_permission(tenant_id, 'sales.view_all')
  or (
    public.has_permission(tenant_id, 'sales.view_own')
    and requested_by = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  )
);

-- sales_select (final form: 0051)
drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales
for select to authenticated
using (
  (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
  and (
    public.has_permission(tenant_id, 'sales.view_all')
    or (
      public.has_permission(tenant_id, 'sales.view_own')
      and recorded_by = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
    )
  )
);

-- subscriptions_select (final form: 0024)
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id
      and t.billing_owner_profile_id = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

-- payments_select (final form: 0024)
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id
      and t.billing_owner_profile_id = coalesce(public.impersonated_profile_id(tenant_id), (select auth.uid()))
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

-- tenant_credits_select (0031, never redefined -- no impersonation
-- coalesce here since 0024 didn't touch this table; reproduced as-is)
drop policy if exists tenant_credits_select on public.tenant_credits;
create policy tenant_credits_select on public.tenant_credits
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = (select auth.uid())
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

-- tenant_addon_subscriptions_select (0034, never redefined)
drop policy if exists tenant_addon_subscriptions_select on public.tenant_addon_subscriptions;
create policy tenant_addon_subscriptions_select on public.tenant_addon_subscriptions
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = (select auth.uid())
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

-- addon_payments_select (0034, never redefined)
drop policy if exists addon_payments_select on public.addon_payments;
create policy addon_payments_select on public.addon_payments
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = (select auth.uid())
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

-- active_branch_sessions_select (0050, never redefined)
drop policy if exists active_branch_sessions_select on public.active_branch_sessions;
create policy active_branch_sessions_select on public.active_branch_sessions
for select to authenticated
using (profile_id = (select auth.uid()));

-- push_subscriptions_select/_insert/_delete (0064): also normalized to
-- `to authenticated` here (they previously had no role clause, which
-- applies to the `public` role -- every other self-scoped policy in
-- this schema is `to authenticated`; this is a strict tightening, not
-- a behavior change for any legitimate device).
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions
for select to authenticated
using (profile_id = (select auth.uid()));

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions
for insert to authenticated
with check (profile_id = (select auth.uid()));

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions
for delete to authenticated
using (profile_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. Unindexed foreign keys directly relevant to the incoming Stock
--    module work (broader FK-index sweep across the rest of the
--    schema deferred -- see report to user).
-- ----------------------------------------------------------------------------

create index if not exists idx_stock_movements_location on public.stock_movements (location_id);
create index if not exists idx_stock_movements_recorded_by on public.stock_movements (recorded_by);
create index if not exists idx_stock_reconciliations_recorded_by on public.stock_reconciliations (recorded_by);
