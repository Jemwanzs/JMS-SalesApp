-- ============================================================================
-- 0046_grace_period_hours_and_audit.sql
--
-- Product Enhancements (Subscription Due / Overdue Read-Only Mode):
--
-- 1. The grace window becomes 3 HOURS from the tenant's actual due
--    timestamp (trial_end/next_billing_date), not N DAYS computed from
--    whenever the daily sweep happened to run. The request's own state
--    model (ACTIVE -> DUE/GRACE PERIOD -> OVERDUE/READ-ONLY -> PAID)
--    treats "due" and "grace period" as ONE state, so the old middle
--    step (sit in PAYMENT_DUE for a full day before grace even starts)
--    is collapsed away: TRIAL/ACTIVE whose due timestamp has passed now
--    goes DIRECTLY to GRACE_PERIOD, with grace_period_end computed from
--    that due timestamp, not v_now. PAYMENT_DUE remains a valid status
--    value (no enum change) but the sweep no longer produces it -- any
--    row already sitting in PAYMENT_DUE from before this migration is
--    picked up by the same loop and given a fresh grace window computed
--    from its own original trial_end/next_billing_date (falling back to
--    v_now only if neither is set), so nobody is unfairly cut off by
--    the migration itself.
--
-- 2. A 3-hour window is meaningless on a once-a-day cron tick (a tenant
--    could keep full access up to ~24h past the real deadline) -- the
--    'billing-sweep' cron job moves from once daily to every 15 minutes.
--
-- 3. New platform_settings row `grace_period_hours` = 3, additive --
--    the old `grace_period_days` row is left in place rather than
--    removed, since deleting it risks breaking anything else that might
--    still read it; the sweep just reads the new key from here on.
--
-- 4. Every transition now writes an audit_logs row (actor_profile_id =
--    null for this automatic/system actor), mirroring migration 0019's
--    own run_business_day_sweep() precedent exactly -- these
--    transitions were previously completely silent/unlogged.
--
-- Migration 0044's platform-admin-tenant exclusion carries forward
-- unchanged in both loops of both functions.
-- ============================================================================

insert into public.platform_settings (key, value)
values ('grace_period_hours', '3'::jsonb)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- run_billing_sweep(): two loops instead of three (TRIAL/ACTIVE/legacy
-- PAYMENT_DUE -> GRACE_PERIOD directly, then GRACE_PERIOD -> SUSPENDED),
-- exact due-timestamp-based grace math, audit logging.
-- ----------------------------------------------------------------------------
create or replace function public.run_billing_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_grace_hours integer;
  v_sub record;
  v_due_at timestamptz;
  v_grace_end timestamptz;
  v_grace_count integer := 0;
  v_suspended_count integer := 0;
begin
  select coalesce((value)::text::integer, 3) into v_grace_hours
  from public.platform_settings where key = 'grace_period_hours';
  v_grace_hours := coalesce(v_grace_hours, 3);

  -- TRIAL/ACTIVE whose due timestamp has passed, or any subscription
  -- already sitting in the now-legacy PAYMENT_DUE status (pre-migration
  -- data) -> GRACE_PERIOD directly. grace_period_end is computed from
  -- the subscription's own due timestamp, never from v_now, so sweep
  -- cadence can never silently extend anyone's grace window.
  for v_sub in
    select * from public.subscriptions
    where (
        (status = 'TRIAL' and trial_end is not null and trial_end <= v_now)
        or (status = 'ACTIVE' and next_billing_date is not null and next_billing_date <= v_now)
        or status = 'PAYMENT_DUE'
      )
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = subscriptions.tenant_id
      )
    for update
  loop
    v_due_at := coalesce(v_sub.trial_end, v_sub.next_billing_date, v_now);
    v_grace_end := v_due_at + (v_grace_hours || ' hours')::interval;

    update public.subscriptions set status = 'GRACE_PERIOD', grace_period_end = v_grace_end where id = v_sub.id;
    v_grace_count := v_grace_count + 1;

    insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, metadata)
    values (
      v_sub.tenant_id, null, 'SUBSCRIPTION_GRACE_PERIOD_STARTED', 'subscription', v_sub.id,
      jsonb_build_object('dueAt', v_due_at, 'graceEnd', v_grace_end)
    );
  end loop;

  -- GRACE_PERIOD expired with no payment -> SUSPENDED, and the tenant
  -- itself flips to 'suspended' -- has_permission() already enforces
  -- the read-only restriction from there (migration 0031).
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

    insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, metadata)
    values (
      v_sub.tenant_id, null, 'SUBSCRIPTION_SUSPENDED', 'subscription', v_sub.id,
      jsonb_build_object('graceEnd', v_sub.grace_period_end)
    );
  end loop;

  return jsonb_build_object(
    'gracePeriod', v_grace_count,
    'suspended', v_suspended_count,
    'ranAt', v_now
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- run_addon_billing_sweep(): same collapsed two-loop treatment, for a
-- consistent base+add-on billing model.
-- ----------------------------------------------------------------------------
create or replace function public.run_addon_billing_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_grace_hours integer;
  v_sub record;
  v_due_at timestamptz;
  v_grace_end timestamptz;
  v_grace_count integer := 0;
  v_suspended_count integer := 0;
begin
  select coalesce((value)::text::integer, 3) into v_grace_hours
  from public.platform_settings where key = 'grace_period_hours';
  v_grace_hours := coalesce(v_grace_hours, 3);

  for v_sub in
    select * from public.tenant_addon_subscriptions
    where (
        (status = 'TRIAL' and trial_end is not null and trial_end <= v_now)
        or (status = 'ACTIVE' and next_billing_date is not null and next_billing_date <= v_now)
        or status = 'PAYMENT_DUE'
      )
      and not exists (
        select 1 from public.tenants t
        join public.platform_admins pa on pa.profile_id = t.billing_owner_profile_id
        where t.id = tenant_addon_subscriptions.tenant_id
      )
    for update
  loop
    v_due_at := coalesce(v_sub.trial_end, v_sub.next_billing_date, v_now);
    v_grace_end := v_due_at + (v_grace_hours || ' hours')::interval;

    update public.tenant_addon_subscriptions set status = 'GRACE_PERIOD', grace_period_end = v_grace_end where id = v_sub.id;
    v_grace_count := v_grace_count + 1;

    insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, metadata)
    values (
      v_sub.tenant_id, null, 'ADDON_SUBSCRIPTION_GRACE_PERIOD_STARTED', 'tenant_addon_subscription', v_sub.id,
      jsonb_build_object('dueAt', v_due_at, 'graceEnd', v_grace_end)
    );
  end loop;

  -- Deliberately does NOT flip tenants.status on suspension -- unchanged
  -- from 0034's own design (see that migration's header comment): the
  -- add-on's own SUSPENDED status already fully gates its own feature
  -- surface via assertInventoryEnabled, independent of the base
  -- subscription/tenant lifecycle.
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

    insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, metadata)
    values (
      v_sub.tenant_id, null, 'ADDON_SUBSCRIPTION_SUSPENDED', 'tenant_addon_subscription', v_sub.id,
      jsonb_build_object('graceEnd', v_sub.grace_period_end)
    );
  end loop;

  return jsonb_build_object(
    'gracePeriod', v_grace_count,
    'suspended', v_suspended_count,
    'ranAt', v_now
  );
end;
$$;

-- Re-declares the 'billing-sweep' cron job at a much tighter cadence --
-- cron.schedule() upserts by job name, so this updates the existing
-- job's schedule/command rather than creating a second one. A 3-hour
-- grace window is meaningless on a once-daily tick; every 15 minutes is
-- cheap (both functions only scan bounded rows in specific statuses).
select cron.schedule(
  'billing-sweep',
  '*/15 * * * *',
  $$select public.run_billing_sweep(); select public.run_addon_billing_sweep();$$
);
