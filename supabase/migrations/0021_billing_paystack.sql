-- ============================================================================
-- 0021_billing_paystack.sql
--
-- Phase 6 (Billing/Paystack): billing_plans/subscriptions schema ->
-- checkout + trial state machine -> webhook handler -> grace period +
-- suspension enforcement -> billing owner UI (docs/14-billing-paystack.md,
-- docs/03-database-schema.md §3.8).
--
-- "Grace period + suspension enforcement folded into has_permission" is
-- MOSTLY ALREADY DONE as of migration 0001: has_permission() already
-- resolves only is_read_only permissions true for a tenant with
-- tenants.status = 'suspended' (see that migration's own comment on the
-- CASE branch). This migration's job is making sure the billing state
-- machine actually FLIPS tenants.status when a subscription becomes
-- SUSPENDED/reactivates -- not re-implementing enforcement that's
-- already live.
--
-- subscriptions/payments/billing_events get RLS with SELECT policies
-- (subscriptions/payments: billing owner OR settings.manage -- which
-- naturally reduces to "billing owner only" during suspension, since
-- settings.manage isn't marked is_read_only and has_permission already
-- blocks it then; billing_events: no client access at all, an internal
-- idempotency ledger nobody outside the webhook needs to see) but ZERO
-- write policies anywhere -- "the webhook route running under the
-- service-role client" is the sole state-transition authority per the
-- doc, so even the initial TRIAL row created at signup goes through
-- TenantService.createTenant's existing service-role bootstrap
-- sequence, never a client-authenticated insert.
--
-- billing_plans is the one table here with an authenticated SELECT
-- policy with no permission gate -- every signed-in user needs to see
-- the plan catalog to choose one at checkout, same reasoning
-- permissions_select (migration 0001) already uses for the permission
-- catalog itself.
--
-- platform_settings (global-scope config: trial_days, grace_period_days)
-- follows platform_admins' own precedent exactly: RLS enabled, ZERO
-- policies for authenticated/anon, reachable only via the service-role
-- client. No admin UI to edit these yet -- Phase 7's "adjust-grace"/
-- "extend-trial" is where that UI belongs; this migration ships the
-- data layer with sensible defaults so that later UI has something
-- real to edit rather than inventing the table then too.
-- ============================================================================

create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  price numeric(12, 2) not null,
  currency text not null default 'KES',
  interval text not null check (interval in ('monthly', 'yearly')),
  features jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.billing_plans enable row level security;

create policy billing_plans_select on public.billing_plans
for select to authenticated
using (true);

insert into public.billing_plans (code, name, price, currency, interval, features) values
  ('standard_monthly', 'Standard', 2500, 'KES', 'monthly', '["Unlimited sales capture", "Analytics & reports", "Enterprise security controls"]'::jsonb);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.billing_plans (id),
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
  updated_at timestamptz not null default now()
);

create index idx_subscriptions_status on public.subscriptions (status);

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;

create policy subscriptions_select on public.subscriptions
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = auth.uid()
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  amount numeric(12, 2) not null,
  currency text not null,
  status text not null check (status in ('success', 'failed', 'pending')),
  paystack_reference text not null unique,
  paid_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_payments_tenant on public.payments (tenant_id, created_at desc);

alter table public.payments enable row level security;

create policy payments_select on public.payments
for select to authenticated
using (
  exists (
    select 1 from public.tenants t
    where t.id = tenant_id and t.billing_owner_profile_id = auth.uid()
  )
  or public.has_permission(tenant_id, 'settings.manage')
);

create table public.billing_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  event_type text not null,
  paystack_event_id text not null unique,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.billing_events enable row level security;
-- No policies -- an internal idempotency ledger, same "service-role
-- only, RLS enabled with zero policies" posture as platform_admins.

create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.platform_settings enable row level security;
-- No policies -- same posture as platform_admins/billing_events.

insert into public.platform_settings (key, value) values
  ('trial_days', '7'::jsonb),
  ('grace_period_days', '3'::jsonb);

-- ============================================================================
-- run_billing_sweep(): the subscription state machine's automatic half
-- (TRIAL -> PAYMENT_DUE -> GRACE_PERIOD -> SUSPENDED). The webhook
-- handles the "customer paid" transitions back toward ACTIVE; this
-- sweep handles every transition that happens purely from time passing
-- with no external event to trigger it. Scheduled via pg_cron (daily --
-- billing-state transitions don't need business-day-sweep's 5-minute
-- granularity), the same Supabase-native mechanism run_business_day_
-- sweep() already uses, unaffected by Vercel Cron's once-daily Hobby-
-- plan limit that gates the report_jobs outbox drain.
-- ============================================================================

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
    where (status = 'TRIAL' and trial_end is not null and trial_end <= v_now)
       or (status = 'ACTIVE' and next_billing_date is not null and next_billing_date <= v_now)
    for update
  loop
    update public.subscriptions set status = 'PAYMENT_DUE' where id = v_sub.id;
    v_due_count := v_due_count + 1;
  end loop;

  -- PAYMENT_DUE for more than a day with no payment -> GRACE_PERIOD.
  for v_sub in
    select * from public.subscriptions
    where status = 'PAYMENT_DUE' and updated_at <= v_now - interval '1 day'
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

revoke execute on function public.run_billing_sweep() from public, authenticated;

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
  $$select public.run_billing_sweep();$$
);
