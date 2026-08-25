-- ============================================================================
-- 0034_inventory_addon_billing.sql
--
-- Product Enhancements #3/#7: Inventory Management ships as a separately-
-- priced, separately-billed add-on -- NOT bundled into the base
-- billing_plans/subscriptions checkout. Every table here is a parallel
-- structure to its base-billing counterpart (0021), keyed by `addon_key`
-- rather than hardcoded to "inventory" specifically, so a second add-on
-- later reuses this same schema instead of a migration-from-scratch.
--
-- addon_payments is a SEPARATE table from `payments`, not an added
-- nullable column there -- `payments.subscription_id` is `not null
-- references subscriptions`, so an add-on payment (which has no real
-- subscriptions.id, only a tenant_addon_subscriptions.id) literally
-- cannot be inserted into that table. Keeping it separate also means the
-- base Sales billing path's schema/constraints are completely untouched
-- by this migration, matching the spec's own "inventory must not
-- interfere with existing architecture" principle applied to billing too.
--
-- tenant_credits gains a nullable `addon_key` column (null = applies to
-- the base subscription, exactly as every existing row already does) and
-- a nullable `applied_to_addon_payment_id` FK (parallel to the existing
-- `applied_to_payment_id`, needed because an addon credit is applied
-- against an addon_payments row, not a payments row) -- reusing the
-- existing credit mechanism rather than building a parallel one.
--
-- `tenant_addon_subscriptions.status` deliberately reuses subscriptions'
-- exact 6-value vocabulary so run_addon_billing_sweep() below can mirror
-- run_billing_sweep()'s TRIAL->PAYMENT_DUE->GRACE_PERIOD->SUSPENDED logic
-- without inventing a second state machine. Unlike the base sweep, this
-- one never touches tenants.status on suspension -- an add-on lapsing
-- must only affect that add-on's own entitlement (Phase 4), never the
-- tenant's overall access, which stays governed solely by the base
-- subscription.
-- ============================================================================

create table public.addon_plans (
  id uuid primary key default gen_random_uuid(),
  addon_key text not null check (addon_key in ('inventory')),
  code text unique not null,
  name text not null,
  price numeric(12, 2) not null,
  currency text not null default 'KES',
  duration_days integer not null default 30,
  discount_percent numeric(5, 2) not null default 0 check (discount_percent >= 0 and discount_percent <= 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_addon_plans_updated_at
before update on public.addon_plans
for each row execute function public.set_updated_at();

alter table public.addon_plans enable row level security;

create policy addon_plans_select on public.addon_plans
for select to authenticated
using (true);

insert into public.addon_plans (addon_key, code, name, price, currency, duration_days) values
  ('inventory', 'inventory_standard_monthly', 'Inventory Management', 500, 'KES', 30);

create table public.tenant_addon_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  addon_key text not null check (addon_key in ('inventory')),
  plan_id uuid references public.addon_plans (id),
  status text not null default 'TRIAL'
    check (status in ('TRIAL', 'ACTIVE', 'PAYMENT_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELLED')),
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_date timestamptz,
  grace_period_end timestamptz,
  paystack_customer_code text,
  paystack_subscription_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, addon_key)
);

create index idx_tenant_addon_subscriptions_status on public.tenant_addon_subscriptions (status);

create trigger set_tenant_addon_subscriptions_updated_at
before update on public.tenant_addon_subscriptions
for each row execute function public.set_updated_at();

alter table public.tenant_addon_subscriptions enable row level security;

create policy tenant_addon_subscriptions_select on public.tenant_addon_subscriptions
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = auth.uid()
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

create table public.addon_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  addon_subscription_id uuid not null references public.tenant_addon_subscriptions (id) on delete cascade,
  amount numeric(12, 2) not null,
  currency text not null,
  status text not null check (status in ('success', 'failed', 'pending')),
  paystack_reference text not null unique,
  paid_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_addon_payments_tenant on public.addon_payments (tenant_id, created_at desc);

alter table public.addon_payments enable row level security;

create policy addon_payments_select on public.addon_payments
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = auth.uid()
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

alter table public.billing_events add column addon_subscription_id uuid references public.tenant_addon_subscriptions (id) on delete set null;

alter table public.tenant_credits add column addon_key text;
alter table public.tenant_credits add column applied_to_addon_payment_id uuid references public.addon_payments (id);

-- Mirrors trial_days exactly, per the Product Enhancements #7 decision
-- ("Super Admin can configure Inventory trial availability"). Defaults
-- to 0 (no trial) rather than a hand-picked nonzero migration value --
-- pricing/trial policy for a paid add-on is a business decision that
-- belongs in the new admin UI this phase ships (PlatformAdminService.
-- setAddonTrialDays), not a hardcoded value nobody revisits later, the
-- exact anti-pattern already flagged for billing_plans/platform_settings
-- before any admin UI existed for those either.
insert into public.platform_settings (key, value) values
  ('inventory_addon_trial_days', '0'::jsonb);

-- ============================================================================
-- run_addon_billing_sweep(): the add-on subscription state machine's
-- automatic half, exact structural mirror of run_billing_sweep() (0021)
-- operating on tenant_addon_subscriptions instead of subscriptions, and
-- reusing the same grace_period_days setting (no separate add-on grace
-- policy). Deliberately does NOT flip tenants.status on suspension -- see
-- this file's header comment.
-- ============================================================================

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
    where (status = 'TRIAL' and trial_end is not null and trial_end <= v_now)
       or (status = 'ACTIVE' and next_billing_date is not null and next_billing_date <= v_now)
    for update
  loop
    update public.tenant_addon_subscriptions set status = 'PAYMENT_DUE' where id = v_sub.id;
    v_due_count := v_due_count + 1;
  end loop;

  for v_sub in
    select * from public.tenant_addon_subscriptions
    where status = 'PAYMENT_DUE' and updated_at <= v_now - interval '1 day'
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

revoke execute on function public.run_addon_billing_sweep() from public, authenticated;

-- Re-declares the SAME 'billing-sweep' cron job (0021) to also run the
-- add-on sweep -- cron.schedule() upserts by job name, so this updates
-- the existing job's command rather than creating a second one.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'billing-sweep';
exception
  when others then
    raise exception 'pg_cron extension not found or inaccessible -- enable it first (Dashboard > Database > Extensions), then re-run this migration. Original error: %', sqlerrm;
end $$;

select cron.schedule(
  'billing-sweep',
  '17 3 * * *',
  $$select public.run_billing_sweep(); select public.run_addon_billing_sweep();$$
);
