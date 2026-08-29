-- ============================================================================
-- 0044_protect_platform_owner_tenant.sql
--
-- The platform owner's own tenant (the tenant whose billing_owner_profile_id
-- is a real public.platform_admins member -- resolved the same way
-- BillingService.resolveAddonTrialDays already does, never a hardcoded
-- email) must always stay active and never receive a "billing push":
--
--   1. run_billing_sweep() (0021) and run_addon_billing_sweep() (0034)
--      now exclude that tenant's subscription/tenant_addon_subscriptions
--      rows from all three automatic transitions (TRIAL/ACTIVE ->
--      PAYMENT_DUE, PAYMENT_DUE -> GRACE_PERIOD, GRACE_PERIOD ->
--      SUSPENDED) -- the sweep simply never touches these rows, so
--      neither subscriptions.status nor tenants.status ever moves.
--   2. A BEFORE UPDATE trigger on tenants blocks any write that would
--      take that tenant's status away from 'active', as a DB-level
--      backstop for any code path that isn't the sweep -- same shape as
--      migration 0039's role-assignment integrity trigger. Safe to RAISE
--      (rather than silently skip) here because every real write path to
--      tenants.status is a single-row update (PlatformAdminService.
--      suspendTenant/deactivateTenant, and the sweep's own per-row
--      update), never a batch statement where one row's rejection would
--      roll back unrelated rows.
--
-- PlatformAdminService.suspendTenant/deactivateTenant also gained an
-- app-layer guard (services/PlatformAdminService.ts) for a clean UI
-- error instead of surfacing a raw Postgres exception -- this trigger is
-- the backstop if that check is ever bypassed.
-- ============================================================================

create or replace function public.enforce_platform_owner_tenant_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'active' and exists (
    select 1 from public.platform_admins pa where pa.profile_id = new.billing_owner_profile_id
  ) then
    raise exception 'Tenant % is the platform owner''s own tenant and cannot leave "active" status', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_platform_owner_tenant_active on public.tenants;

create trigger trg_enforce_platform_owner_tenant_active
before update on public.tenants
for each row execute function public.enforce_platform_owner_tenant_active();

-- ----------------------------------------------------------------------------
-- run_billing_sweep(): identical to 0021's version except each of the three
-- loop queries now excludes subscriptions belonging to a platform-admin-
-- owned tenant.
-- ----------------------------------------------------------------------------
create or replace function public.run_billing_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_grace_days integer;
  v_sub record;
  v_due_count integer := 0;
  v_grace_count integer := 0;
  v_suspended_count integer := 0;
begin
  select coalesce((value)::text::integer, 3) into v_grace_days
  from public.platform_settings where key = 'grace_period_days';
  v_grace_days := coalesce(v_grace_days, 3);

  -- TRIAL / ACTIVE whose billing date has passed -> PAYMENT_DUE.
  for v_sub in
    select * from public.subscriptions
    where ((status = 'TRIAL' and trial_end is not null and trial_end <= v_now)
       or (status = 'ACTIVE' and next_billing_date is not null and next_billing_date <= v_now))
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = subscriptions.tenant_id
      )
    for update
  loop
    update public.subscriptions set status = 'PAYMENT_DUE' where id = v_sub.id;
    v_due_count := v_due_count + 1;
  end loop;

  -- PAYMENT_DUE for more than a day with no payment -> GRACE_PERIOD.
  for v_sub in
    select * from public.subscriptions
    where status = 'PAYMENT_DUE' and updated_at <= v_now - interval '1 day'
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = subscriptions.tenant_id
      )
    for update
  loop
    update public.subscriptions
    set status = 'GRACE_PERIOD', grace_period_end = v_now + (v_grace_days || ' days')::interval
    where id = v_sub.id;
    v_grace_count := v_grace_count + 1;
  end loop;

  -- GRACE_PERIOD expired with no payment -> SUSPENDED, and the tenant
  -- itself flips to 'suspended' -- has_permission() already enforces
  -- the read-only-only restriction from there (migration 0001).
  for v_sub in
    select * from public.subscriptions
    where status = 'GRACE_PERIOD' and grace_period_end is not null and grace_period_end <= v_now
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = subscriptions.tenant_id
      )
    for update
  loop
    update public.subscriptions set status = 'SUSPENDED' where id = v_sub.id;
    update public.tenants set status = 'suspended' where id = v_sub.tenant_id;
    v_suspended_count := v_suspended_count + 1;
  end loop;

  return jsonb_build_object(
    'paymentDue', v_due_count,
    'gracePeriod', v_grace_count,
    'suspended', v_suspended_count,
    'ranAt', v_now
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- run_addon_billing_sweep(): identical to 0034's version, same exclusion
-- added to all three loop queries (via tenant_addon_subscriptions.tenant_id).
-- ----------------------------------------------------------------------------
create or replace function public.run_addon_billing_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_grace_days integer;
  v_sub record;
  v_due_count integer := 0;
  v_grace_count integer := 0;
  v_suspended_count integer := 0;
begin
  select coalesce((value)::text::integer, 3) into v_grace_days
  from public.platform_settings where key = 'grace_period_days';
  v_grace_days := coalesce(v_grace_days, 3);

  for v_sub in
    select * from public.tenant_addon_subscriptions
    where ((status = 'TRIAL' and trial_end is not null and trial_end <= v_now)
       or (status = 'ACTIVE' and next_billing_date is not null and next_billing_date <= v_now))
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = tenant_addon_subscriptions.tenant_id
      )
    for update
  loop
    update public.tenant_addon_subscriptions set status = 'PAYMENT_DUE' where id = v_sub.id;
    v_due_count := v_due_count + 1;
  end loop;

  for v_sub in
    select * from public.tenant_addon_subscriptions
    where status = 'PAYMENT_DUE' and updated_at <= v_now - interval '1 day'
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = tenant_addon_subscriptions.tenant_id
      )
    for update
  loop
    update public.tenant_addon_subscriptions
    set status = 'GRACE_PERIOD', grace_period_end = v_now + (v_grace_days || ' days')::interval
    where id = v_sub.id;
    v_grace_count := v_grace_count + 1;
  end loop;

  for v_sub in
    select * from public.tenant_addon_subscriptions
    where status = 'GRACE_PERIOD' and grace_period_end is not null and grace_period_end <= v_now
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = tenant_addon_subscriptions.tenant_id
      )
    for update
  loop
    update public.tenant_addon_subscriptions set status = 'SUSPENDED' where id = v_sub.id;
    v_suspended_count := v_suspended_count + 1;
  end loop;

  return jsonb_build_object(
    'paymentDue', v_due_count,
    'gracePeriod', v_grace_count,
    'suspended', v_suspended_count,
    'ranAt', v_now
  );
end;
$$;
