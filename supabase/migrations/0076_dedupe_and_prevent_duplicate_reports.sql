-- ============================================================================
-- 0076_dedupe_and_prevent_duplicate_reports.sql
--
-- Fixes a real, already-manifested bug: the Reports tab showing two
-- identical cards for the same date (confirmed live -- three duplicate
-- pairs found in production, e.g. two byte-identical "daily" rows for
-- 2026-09-02, created ~15s apart). Root cause, traced through the data
-- itself: `report_jobs` has no protection against being queued twice for
-- the same business day -- `queue_daily_report_job()` (migration 0015,
-- the manual "Close Day" button's own queuing call) and
-- `run_business_day_sweep()`'s automatic close (migrations 0011/.../0075)
-- are two INDEPENDENT insertion points with no shared idempotency check,
-- so a business day that's ever closed more than once (an automatic
-- close followed by a manual reopen-then-reclose, confirmed as the
-- actual pattern in this tenant's own history: some business_day_ids
-- have two separate report_jobs rows created HOURS apart, not a tight
-- race) queues a second `daily_business_day_report` job -- and
-- ReportService.generateDailyReport does a plain, unguarded `.insert()`
-- into `reports` with no existence check, so the outbox worker
-- (app/api/cron/outbox) dutifully generates a second, fully duplicate
-- report row from that second job.
--
-- Three layers, so no single insertion point (present or future) can
-- ever reintroduce this:
--
-- 1. Dedupe existing rows in both tables (keep the earliest row per
--    group -- the payloads are computed from the same closed day's data
--    either way, so which specific row id survives doesn't matter).
-- 2. A unique index on each table, so a duplicate INSERT fails/no-ops
--    at the database level regardless of which code path attempts it.
-- 3. Every report_jobs INSERT site gets `on conflict do nothing` (the
--    same idempotent-insert idiom this codebase already uses for
--    stock_movements' sale-driven rows, migration 0067) -- full
--    create-or-replace of run_business_day_sweep() and
--    queue_daily_report_job(), never editing an already-applied
--    migration. Bodies are otherwise byte-for-byte identical to their
--    current (0075 / 0015) versions.
--
-- ReportService.generateDailyReport/generateCorrectionsReport switch
-- from .insert() to .upsert() against the new reports unique index in
-- the same commit as this migration (services/ReportService.ts) -- an
-- upsert is the correct behavior for the reports table specifically
-- (silently keep the freshest computed payload) where report_jobs
-- instead uses do-nothing (the FIRST queued job should win; a second
-- attempt to queue the same work is just redundant, not fresher).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Dedupe existing data (keep earliest row per group).
-- ----------------------------------------------------------------------------
with ranked as (
  select id, row_number() over (
    partition by tenant_id, location_id, report_type, period_start
    order by created_at asc, id asc
  ) as rn
  from public.reports
)
delete from public.reports
where id in (select id from ranked where rn > 1);

with ranked as (
  select id, row_number() over (
    partition by tenant_id, job_type, (payload ->> 'business_day_id')
    order by created_at asc, id asc
  ) as rn
  from public.report_jobs
)
delete from public.report_jobs
where id in (select id from ranked where rn > 1);

-- ----------------------------------------------------------------------------
-- 2. Unique indexes -- the actual, permanent backstop.
-- ----------------------------------------------------------------------------
create unique index reports_tenant_location_type_period_unique
  on public.reports (tenant_id, location_id, report_type, period_start);

create unique index report_jobs_tenant_type_business_day_unique
  on public.report_jobs (tenant_id, job_type, (payload ->> 'business_day_id'));

-- ----------------------------------------------------------------------------
-- 3. Idempotent inserts at every report_jobs insertion site.
-- ----------------------------------------------------------------------------
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
  v_crossmid_day record;
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
      where business_day_id = v_day.id and status not in ('voided', 'corrected', 'deleted');

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
      )
      on conflict (tenant_id, job_type, (payload ->> 'business_day_id')) do nothing;

      -- Web Push (0065): the same close event also fans out a push
      -- notification to every subscribed, currently-active member of
      -- this tenant -- see PushNotificationService.sendDailySummaryForTenant.
      insert into public.report_jobs (tenant_id, job_type, payload)
      values (
        v_day.tenant_id, 'push_daily_summary',
        jsonb_build_object('business_day_id', v_day.id, 'location_id', v_day.location_id)
      )
      on conflict (tenant_id, job_type, (payload ->> 'business_day_id')) do nothing;
    end if;
  end loop;

  -- Cross-midnight closing pass (0055, fixed in 0056): close any OPEN
  -- business day whose own stored scheduled close time -- cross-
  -- midnight adjusted -- has passed, regardless of which calendar date
  -- that row is dated. The loop above only ever looks at the CURRENT
  -- calendar date's row per location, so a cross-midnight day (opened
  -- yesterday, due to close after midnight today) is otherwise never
  -- revisited once the calendar rolls over. For a same-day tenant this
  -- is a harmless no-op (the loop above already closed it earlier in
  -- this same function run).
  for v_crossmid_day in
    select bd.*, coalesce(l.timezone, t.timezone, 'UTC') as effective_timezone
    from public.business_days bd
    join public.locations l on l.id = bd.location_id
    join public.tenants t on t.id = bd.tenant_id
    where bd.status = 'open'
      and bd.scheduled_open_time is not null
      and bd.scheduled_close_time is not null
    for update of bd
  loop
    v_open_at := (v_crossmid_day.business_date + v_crossmid_day.scheduled_open_time) at time zone v_crossmid_day.effective_timezone;
    v_close_at := (v_crossmid_day.business_date + v_crossmid_day.scheduled_close_time) at time zone v_crossmid_day.effective_timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    if v_now < v_close_at then
      continue;
    end if;

    select coalesce(sum(actual_amount), 0), count(*)
    into v_gross, v_count
    from public.sales
    where business_day_id = v_crossmid_day.id and status not in ('voided', 'corrected', 'deleted');

    update public.business_days
    set status = 'closed',
        closed_at = v_close_at,
        closing_reason = 'Automatic (scheduled hours, cross-midnight)',
        aggregates = jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
    where id = v_crossmid_day.id;

    v_closed_count := v_closed_count + 1;

    insert into public.audit_logs (tenant_id, actor_profile_id, action, entity_type, entity_id, reason, metadata)
    values (
      v_crossmid_day.tenant_id, null, 'BUSINESS_DAY_CLOSED', 'business_day', v_crossmid_day.id,
      'Automatic (scheduled hours, cross-midnight)',
      jsonb_build_object('grossSales', v_gross, 'transactionCount', v_count)
    );

    insert into public.report_jobs (tenant_id, job_type, payload)
    values (
      v_crossmid_day.tenant_id, 'daily_business_day_report',
      jsonb_build_object('business_day_id', v_crossmid_day.id, 'location_id', v_crossmid_day.location_id)
    )
    on conflict (tenant_id, job_type, (payload ->> 'business_day_id')) do nothing;

    -- Web Push (0065): same reasoning as the main loop's close above.
    insert into public.report_jobs (tenant_id, job_type, payload)
    values (
      v_crossmid_day.tenant_id, 'push_daily_summary',
      jsonb_build_object('business_day_id', v_crossmid_day.id, 'location_id', v_crossmid_day.location_id)
    )
    on conflict (tenant_id, job_type, (payload ->> 'business_day_id')) do nothing;
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

-- queue_daily_report_job() -- the manual "Close Day" button's own
-- queuing call (migration 0015). Same on-conflict addition; everything
-- else byte-for-byte identical.
create or replace function public.queue_daily_report_job(p_business_day_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day public.business_days;
begin
  select * into v_day from public.business_days where id = p_business_day_id;
  if not found then
    raise exception 'Business day not found';
  end if;

  if not public.is_tenant_member(v_day.tenant_id) then
    raise exception 'Not authorized';
  end if;

  insert into public.report_jobs (tenant_id, job_type, payload)
  values (
    v_day.tenant_id, 'daily_business_day_report',
    jsonb_build_object('business_day_id', v_day.id, 'location_id', v_day.location_id)
  )
  on conflict (tenant_id, job_type, (payload ->> 'business_day_id')) do nothing;
end;
$$;

revoke execute on function public.run_business_day_sweep() from public, authenticated;
revoke execute on function public.queue_daily_report_job(uuid) from public;
grant execute on function public.queue_daily_report_job(uuid) to authenticated;
