-- ============================================================================
-- 0019_audit_logs.sql
--
-- Phase 4 (Enterprise Controls): the full audit_logs coverage pass
-- (docs/05-authentication-security.md's "Audit logging" section,
-- docs/03-database-schema.md's audit_logs row, docs/19-security-
-- checklist.md's non-negotiables). Last remaining Phase 4 item.
--
-- Zero write policies -- same posture as login_events/sessions
-- (migration 0016) and for the same reason: several event types this
-- table records (FAILED_LOGIN chief among them) have no authenticated
-- session for a self-scoped INSERT policy to key off of, so every write
-- goes through AuditService on the service-role client rather than a
-- mix of "sometimes RLS-respecting, sometimes not" depending on event
-- type. No UPDATE/DELETE policy at all -- immutability is enforced by
-- the database, not by AuditService's discipline alone (docs/05).
-- ============================================================================

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb,
  new_values jsonb,
  reason text,
  ip text,
  device text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_tenant on public.audit_logs (tenant_id, created_at desc);
create index idx_audit_logs_actor on public.audit_logs (actor_profile_id, created_at desc);
create index idx_audit_logs_entity on public.audit_logs (entity_type, entity_id);

alter table public.audit_logs enable row level security;

-- Tenant-wide audit visibility reuses security.manage -- the same
-- permission that already gates tenant-wide login_events visibility
-- (migration 0016) and the security centre generally, rather than
-- inventing a new permission for a closely related concern.
create policy audit_logs_select on public.audit_logs
for select to authenticated
using (
  tenant_id is not null and public.has_permission(tenant_id, 'security.manage')
);

-- No insert/update/delete policy: written exclusively via AuditService
-- on the service-role client (lib/supabase/service-role.ts).

-- ============================================================================
-- BUSINESS_DAY_OPENED/CLOSED has no app-layer caller for the automatic
-- case -- the only "close" path in production today is
-- run_business_day_sweep() (pg_cron) and auto_relock_expired_business_day()
-- (both pg_cron AND BusinessDayService.getTodayBusinessDay()'s lazy
-- check, migration 0009's docs). Manual open/reopen are already logged
-- at the app layer (open-business-day.ts/reopen-business-day.ts,
-- AuditService), where a real actor_profile_id exists; these automatic
-- transitions have none (actor_profile_id null = system actor, same
-- convention audit_logs.actor_profile_id being nullable already
-- implies). Full create-or-replace of both functions -- the
-- scheduling/opening/closing/relock/temporary-access-expiry logic
-- itself is byte-for-byte unchanged from migration 0017, only the
-- audit_logs inserts are new.
-- ============================================================================

create or replace function public.run_business_day_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_loc record;
  v_now timestamptz := now();
  v_local_date date;
  v_dow smallint;
  v_hours record;
  v_day public.business_days;
  v_open_at timestamptz;
  v_close_at timestamptz;
  v_gross numeric;
  v_count integer;
  v_scheduled_count integer := 0;
  v_opened_count integer := 0;
  v_closed_count integer := 0;
  v_relocked_count integer := 0;
  v_access_expired_count integer := 0;
begin
  for v_loc in
    select l.id as location_id, l.tenant_id, coalesce(l.timezone, t.timezone, 'UTC') as timezone
    from public.locations l
    join public.tenants t on t.id = l.tenant_id
    where l.status = 'active'
  loop
    v_local_date := (v_now at time zone v_loc.timezone)::date;
    v_dow := extract(dow from v_local_date);

    select
      coalesce(sh.is_closed, lh.closed_all_day, false) as closed_all_day,
      coalesce(sh.open_time, lh.open_time) as open_time,
      coalesce(sh.close_time, lh.close_time) as close_time
    into v_hours
    from (select 1) as _dummy
    left join public.special_hours sh
      on sh.location_id = v_loc.location_id and sh.date = v_local_date
    left join public.location_hours lh
      on lh.location_id = v_loc.location_id and lh.day_of_week = v_dow;

    if v_hours.closed_all_day or v_hours.open_time is null or v_hours.close_time is null then
      continue;
    end if;

    v_open_at := (v_local_date + v_hours.open_time) at time zone v_loc.timezone;
    v_close_at := (v_local_date + v_hours.close_time) at time zone v_loc.timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    select * into v_day
    from public.business_days
    where tenant_id = v_loc.tenant_id
      and location_id = v_loc.location_id
      and business_date = v_local_date
    for update;

    if not found then
      if v_now >= v_close_at then
        continue;
      end if;

      insert into public.business_days (
        tenant_id, location_id, business_date, status,
        scheduled_open_time, scheduled_close_time
      )
      values (
        v_loc.tenant_id, v_loc.location_id, v_local_date, 'scheduled',
        v_hours.open_time, v_hours.close_time
      )
      returning * into v_day;
      v_scheduled_count := v_scheduled_count + 1;
    end if;

    if v_day.status = 'scheduled' and v_now >= v_close_at then
      update public.business_days
      set status = 'closed',
          closed_at = v_close_at,
          closing_reason = 'Automatically closed without opening (scheduled window elapsed)',
          aggregates = jsonb_build_object('grossSales', 0, 'transactionCount', 0)
      where id = v_day.id
      returning * into v_day;
      v_closed_count := v_closed_count + 1;

      insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, reason)
      values (v_day.tenant_id, null, 'BUSINESS_DAY_CLOSED', 'business_day', v_day.id, v_day.closing_reason);

      continue;
    end if;

    if v_day.status = 'scheduled' and v_now >= v_open_at and v_now < v_close_at then
      update public.business_days
      set status = 'open',
          opened_at = v_open_at,
          opening_reason = 'Automatic (scheduled hours)'
      where id = v_day.id
      returning * into v_day;
      v_opened_count := v_opened_count + 1;

      insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, reason)
      values (v_day.tenant_id, null, 'BUSINESS_DAY_OPENED', 'business_day', v_day.id, v_day.opening_reason);
    end if;

    if v_day.status = 'open' and v_now >= v_close_at then
      select coalesce(sum(actual_amount), 0), count(*)
      into v_gross, v_count
      from public.sales
      where business_day_id = v_day.id and status <> 'voided';

      update public.business_days
      set status = 'closed',
          closed_at = v_close_at,
          closing_reason = 'Automatic (scheduled hours)',
          aggregates = jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
      where id = v_day.id
      returning * into v_day;
      v_closed_count := v_closed_count + 1;

      insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, reason, metadata)
      values (
        v_day.tenant_id, null, 'BUSINESS_DAY_CLOSED', 'business_day', v_day.id, v_day.closing_reason,
        jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
      );

      insert into public.report_jobs (tenant_id, job_type, payload)
      values (
        v_day.tenant_id, 'daily_business_day_report',
        jsonb_build_object('business_day_id', v_day.id, 'location_id', v_day.location_id)
      );
    end if;
  end loop;

  for v_day in
    select *
    from public.business_days
    where status = 'reopened'
      and reopen_expires_at is not null
      and reopen_expires_at <= v_now
    for update
  loop
    perform public.auto_relock_expired_business_day(v_day.id);
    v_relocked_count := v_relocked_count + 1;
  end loop;

  with expired as (
    update public.temporary_access_requests
    set status = 'expired'
    where status = 'approved'
      and granted_until is not null
      and granted_until <= v_now
    returning 1
  )
  select count(*) into v_access_expired_count from expired;

  return jsonb_build_object(
    'scheduled', v_scheduled_count,
    'opened', v_opened_count,
    'closed', v_closed_count,
    'relocked', v_relocked_count,
    'accessExpired', v_access_expired_count,
    'ranAt', v_now
  );
end;
$$;

create or replace function public.auto_relock_expired_business_day(p_business_day_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day public.business_days;
  v_gross numeric;
  v_count integer;
begin
  select * into v_day from public.business_days where id = p_business_day_id for update;
  if not found then
    raise exception 'Business day not found';
  end if;

  if v_day.status <> 'reopened' or v_day.reopen_expires_at is null or v_day.reopen_expires_at > now() then
    return jsonb_build_object('status', v_day.status, 'relocked', false);
  end if;

  -- Recompute aggregates, not just flip status -- sales may have been
  -- recorded during the reopened window (that's the whole point of
  -- reopening), so the original close-time aggregates would be stale.
  select coalesce(sum(actual_amount), 0), count(*)
  into v_gross, v_count
  from public.sales
  where business_day_id = p_business_day_id and status <> 'voided';

  update public.business_days
  set status = 'closed',
      aggregates = jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
  where id = p_business_day_id;

  insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, reason, metadata)
  values (
    v_day.tenant_id, null, 'BUSINESS_DAY_CLOSED', 'business_day', p_business_day_id,
    'Automatically relocked (reopened window expired)',
    jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
  );

  return jsonb_build_object('status', 'closed', 'relocked', true);
end;
$$;

revoke execute on function public.run_business_day_sweep() from public, authenticated;
revoke execute on function public.auto_relock_expired_business_day(uuid) from public;
grant execute on function public.auto_relock_expired_business_day(uuid) to authenticated;
