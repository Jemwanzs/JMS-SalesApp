-- ============================================================================
-- 0011_business_day_sweep_and_report_jobs.sql
--
-- Phase 2f: pg_cron automation for business-day state transitions, per
-- docs/09-business-day-engine.md's "pg_cron for state, Vercel Cron for
-- side effects" split. Requires the pg_cron extension already enabled on
-- the project (Dashboard > Database > Extensions -- a one-time project
-- setting, not something a migration should try to create).
--
-- report_jobs is the outbox table (doc 03 section 3.4): the sweep INSERTs
-- into it inside the same transaction as a business-day close, never
-- calling Resend/etc. directly from SQL. A separate Vercel Cron route
-- (app/api/cron/outbox) drains it. `report_id` stays nullable with no FK
-- yet -- the `reports` table itself is Phase 3d, not built here; when it
-- lands, a follow-up migration adds the FK (never edit an applied
-- migration). `payload jsonb` is an addition beyond doc 03's minimal
-- column list, mirroring approval_requests.request_payload -- needed to
-- carry the business_day_id since there's no report_id to hang it off of
-- yet.
--
-- notifications/notification_preferences (doc 03 section 3.6) are NOT
-- created here. Fanning out a business-day-closed notification needs a
-- recipient-targeting decision (which permission/role gets notified) that
-- hasn't been made -- deliberately deferred rather than guessed, same as
-- REVERSE (2e) and MFA-gated reopen (2h). report_jobs alone is enough for
-- this increment's actual job: closing a day and queuing its report.
-- ============================================================================

create table public.report_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  report_id uuid,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_report_jobs_tenant on public.report_jobs (tenant_id);
create index idx_report_jobs_status_scheduled on public.report_jobs (status, scheduled_for);

create trigger set_report_jobs_updated_at
before update on public.report_jobs
for each row execute function public.set_updated_at();

-- RLS enabled with zero policies, same pattern as platform_admins: this
-- is an internal outbox, drained by the service-role Vercel Cron route,
-- not something any tenant user reads or writes directly yet.
alter table public.report_jobs enable row level security;

-- ============================================================================
-- run_business_day_sweep(): the pg_cron sweep body. For every location,
-- resolves today's effective hours (special_hours overrides
-- location_hours, matching BusinessDayService.getEffectiveTimezone's
-- location-then-tenant fallback for timezone), and:
--   - creates today's business_days row (status 'scheduled') once its
--     date is known but before opening time, if it doesn't exist yet;
--   - transitions scheduled/absent -> open at the scheduled open time;
--   - transitions open -> closed at the scheduled close time, computing
--     aggregates exactly like BusinessDayService.closeDay does, and
--     queues a report_jobs row (the outbox);
--   - relocks any 'reopened' day whose reopen_expires_at has passed, by
--     delegating to auto_relock_expired_business_day() (migration 0009)
--     so the aggregate-recompute logic lives in exactly one place;
--   - a 'scheduled' day whose close time has already passed without ever
--     opening (e.g. the sweep didn't run for a while) is closed directly
--     with zero aggregates rather than left stuck forever -- no sale
--     could have been recorded against a day that was never open.
-- Manual open/close (BusinessDayService.openDay/closeDay) are untouched
-- by this function and still work independently; the sweep only acts on
-- what manual action hasn't already handled by the time it runs.
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

    -- No configured hours today (closed all day, or hours never set up
    -- for this location/day) -- nothing for the sweep to automate.
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
        -- Window already fully elapsed before the sweep ever saw this
        -- location/day (e.g. sweep was paused) -- nothing to open.
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
      -- Never opened and its window has already passed -- close it
      -- directly rather than leaving it stuck; zero aggregates, since no
      -- sale can reference a business_day_id that was never open.
      update public.business_days
      set status = 'closed',
          closed_at = v_close_at,
          closing_reason = 'Automatically closed without opening (scheduled window elapsed)',
          aggregates = jsonb_build_object('grossSales', 0, 'transactionCount', 0)
      where id = v_day.id
      returning * into v_day;
      v_closed_count := v_closed_count + 1;
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

  return jsonb_build_object(
    'scheduled', v_scheduled_count,
    'opened', v_opened_count,
    'closed', v_closed_count,
    'relocked', v_relocked_count,
    'ranAt', v_now
  );
end;
$$;

-- System-triggered only (pg_cron, running as the migration's owning
-- role) -- never callable directly by a tenant user, same posture as
-- _apply_business_day_reopen.
revoke execute on function public.run_business_day_sweep() from public, authenticated;

-- Idempotent re-schedule: unschedule first so re-running this migration
-- (or a future one that needs to change the cadence) never errors on a
-- duplicate job name.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'business-day-sweep';
exception
  when others then
    raise exception 'pg_cron extension not found or inaccessible -- enable it first (Dashboard > Database > Extensions), then re-run this migration. Original error: %', sqlerrm;
end $$;

select cron.schedule(
  'business-day-sweep',
  '*/5 * * * *',
  $$select public.run_business_day_sweep();$$
);
