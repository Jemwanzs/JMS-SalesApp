-- ============================================================================
-- 0055_business_day_rollover.sql
--
-- Business Day Rollover & After-Midnight Sales: a tenant can configure
-- hours that cross midnight (e.g. 07:00 -> 03:00 the next calendar day).
-- Two real, confirmed bugs, not one:
--
-- 1. BusinessDayService.getTodayBusinessDay() resolved "today" as a raw
--    calendar date and looked up business_days WHERE business_date =
--    <that date>. For a 07:00->03:00 tenant, at 01:00 the calendar date
--    is already tomorrow, so this found nothing and returned null --
--    even though yesterday's business day (opened 07:00, due to close
--    03:00) is still genuinely 'open'. sales/page.tsx gates sale capture
--    on this, so capture itself stopped working at midnight, not just
--    reporting.
--
-- 2. run_business_day_sweep() (0011, last redefined in full by 0019)
--    already contains correct cross-midnight math
--    (`if close_at <= open_at then close_at += 1 day`) -- but only ever
--    applies it to the CURRENT calendar date's row, once per location
--    per tick. Once the calendar rolls over, no future tick ever
--    revisits yesterday's still-open row, so a cross-midnight day never
--    auto-closes at its real 03:00 deadline -- it stays 'open' forever.
--
-- resolve_effective_business_date() is the one new canonical resolver
-- (SQL, not duplicated in TypeScript) both the app and a new pass in the
-- sweep can lean on -- given "now", it works out which business date is
-- actually in effect: yesterday's window if still extended past
-- midnight, else today's window if open, else (the gap between closing
-- and the next opening) the most recently CLOSED day, matching the
-- spec's explicit "default to the most recent completed business day
-- until the next one opens." Plain SECURITY INVOKER, not DEFINER --
-- business_days_select/location_hours_select/special_hours_select are
-- already is_tenant_member-gated for an ordinary read, so no elevated
-- privilege is needed here (unlike the write-side RPCs this codebase
-- reserves SECURITY DEFINER for).
--
-- The sweep's fix is additive: one more pass, after its existing
-- per-location "today" loop, closing ANY 'open' row whose own stored
-- scheduled_open_time/scheduled_close_time (already columns on the row,
-- set at open time) put its cross-midnight-adjusted deadline in the
-- past -- regardless of which calendar date that row is dated. For a
-- same-day tenant the existing loop already closed the row before this
-- pass ever sees it (harmless no-op); for a cross-midnight tenant, this
-- is the pass that was missing entirely. The rest of the function body
-- below is byte-for-byte unchanged from migration 0019's version (the
-- latest prior redefinition) except for this new pass.
-- ============================================================================

create or replace function public.resolve_effective_business_date(
  p_tenant_id uuid,
  p_location_id uuid
)
returns table (business_date date, is_live boolean, business_day_id uuid)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_timezone text;
  v_now timestamptz := now();
  v_local_date date;
  v_yesterday_date date;
  v_dow smallint;
  v_hours record;
  v_open_at timestamptz;
  v_close_at timestamptz;
  v_day public.business_days;
begin
  select coalesce(l.timezone, t.timezone, 'UTC') into v_timezone
  from public.locations l
  join public.tenants t on t.id = l.tenant_id
  where l.id = p_location_id;

  v_timezone := coalesce(v_timezone, 'UTC');
  v_local_date := (v_now at time zone v_timezone)::date;
  v_yesterday_date := v_local_date - 1;

  -- 1. Still within YESTERDAY's window, extended past midnight?
  v_dow := extract(dow from v_yesterday_date);
  select
    coalesce(sh.is_closed, lh.closed_all_day, false) as closed_all_day,
    coalesce(sh.open_time, lh.open_time) as open_time,
    coalesce(sh.close_time, lh.close_time) as close_time
  into v_hours
  from (select 1) as _dummy
  left join public.special_hours sh on sh.location_id = p_location_id and sh.date = v_yesterday_date
  left join public.location_hours lh on lh.location_id = p_location_id and lh.day_of_week = v_dow;

  if not v_hours.closed_all_day and v_hours.open_time is not null and v_hours.close_time is not null then
    v_open_at := (v_yesterday_date + v_hours.open_time) at time zone v_timezone;
    v_close_at := (v_yesterday_date + v_hours.close_time) at time zone v_timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    if v_now >= v_open_at and v_now < v_close_at then
      select * into v_day from public.business_days
      where tenant_id = p_tenant_id and location_id = p_location_id and business_date = v_yesterday_date;

      return query select v_yesterday_date, coalesce(v_day.status in ('open', 'reopened'), false), v_day.id;
      return;
    end if;
  end if;

  -- 2. Within TODAY's window?
  v_dow := extract(dow from v_local_date);
  select
    coalesce(sh.is_closed, lh.closed_all_day, false) as closed_all_day,
    coalesce(sh.open_time, lh.open_time) as open_time,
    coalesce(sh.close_time, lh.close_time) as close_time
  into v_hours
  from (select 1) as _dummy
  left join public.special_hours sh on sh.location_id = p_location_id and sh.date = v_local_date
  left join public.location_hours lh on lh.location_id = p_location_id and lh.day_of_week = v_dow;

  if not v_hours.closed_all_day and v_hours.open_time is not null and v_hours.close_time is not null then
    v_open_at := (v_local_date + v_hours.open_time) at time zone v_timezone;
    v_close_at := (v_local_date + v_hours.close_time) at time zone v_timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    if v_now >= v_open_at and v_now < v_close_at then
      select * into v_day from public.business_days
      where tenant_id = p_tenant_id and location_id = p_location_id and business_date = v_local_date;

      return query select v_local_date, coalesce(v_day.status in ('open', 'reopened'), false), v_day.id;
      return;
    end if;
  end if;

  -- 3. The gap between closing and the next opening (or no hours
  -- configured at all) -- default to the most recently CLOSED day.
  select * into v_day from public.business_days
  where tenant_id = p_tenant_id and location_id = p_location_id and status = 'closed'
  order by business_date desc
  limit 1;

  if found then
    return query select v_day.business_date, false, v_day.id;
  else
    -- Brand-new location with no business_days history yet -- a sane,
    -- non-erroring default rather than an empty result set.
    return query select v_local_date, false, null::uuid;
  end if;
end;
$$;

revoke execute on function public.resolve_effective_business_date(uuid, uuid) from public;
grant execute on function public.resolve_effective_business_date(uuid, uuid) to authenticated;

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

  -- NEW pass (0055): close any OPEN business day whose own stored
  -- scheduled close time -- cross-midnight adjusted -- has passed,
  -- regardless of which calendar date that row is dated. The loop above
  -- only ever looks at the CURRENT calendar date's row per location, so
  -- a cross-midnight day (opened yesterday, due to close after midnight
  -- today) is otherwise never revisited once the calendar rolls over.
  -- For a same-day tenant this is a harmless no-op (the loop above
  -- already closed it earlier in this same function run).
  for v_day in
    select bd.*, coalesce(l.timezone, t.timezone, 'UTC') as effective_timezone
    from public.business_days bd
    join public.locations l on l.id = bd.location_id
    join public.tenants t on t.id = bd.tenant_id
    where bd.status = 'open'
      and bd.scheduled_open_time is not null
      and bd.scheduled_close_time is not null
    for update of bd
  loop
    v_open_at := (v_day.business_date + v_day.scheduled_open_time) at time zone v_day.effective_timezone;
    v_close_at := (v_day.business_date + v_day.scheduled_close_time) at time zone v_day.effective_timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    if v_now < v_close_at then
      continue;
    end if;

    select coalesce(sum(actual_amount), 0), count(*)
    into v_gross, v_count
    from public.sales
    where business_day_id = v_day.id and status <> 'voided';

    update public.business_days
    set status = 'closed',
        closed_at = v_close_at,
        closing_reason = 'Automatic (scheduled hours, cross-midnight)',
        aggregates = jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
    where id = v_day.id;

    v_closed_count := v_closed_count + 1;

    insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, reason, metadata)
    values (
      v_day.tenant_id, null, 'BUSINESS_DAY_CLOSED', 'business_day', v_day.id,
      'Automatic (scheduled hours, cross-midnight)',
      jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
    );

    insert into public.report_jobs (tenant_id, job_type, payload)
    values (
      v_day.tenant_id, 'daily_business_day_report',
      jsonb_build_object('business_day_id', v_day.id, 'location_id', v_day.location_id)
    );
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

revoke execute on function public.run_business_day_sweep() from public, authenticated;
