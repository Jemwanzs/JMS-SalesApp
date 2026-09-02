-- ============================================================================
-- 0059_resolver_prefers_frozen_schedule.sql
--
-- Live sandbox testing surfaced a real design gap:
-- resolve_effective_business_date() re-derives a day's open/close window
-- FRESH from special_hours/location_hours on every call, while
-- run_business_day_sweep()'s cross-midnight closing pass (0056) trusts
-- the business_days row's OWN scheduled_open_time/scheduled_close_time,
-- frozen at whichever moment that row was opened. These two only ever
-- agree by coincidence -- if a tenant edits their hours config (or a
-- day's own scheduled_close_time is corrected) AFTER a cross-midnight
-- day has already opened, the resolver's "is yesterday still live"
-- check silently starts using the NEW config retroactively against an
-- ALREADY-OPEN day, while the sweep that actually closes it goes by the
-- OLD frozen schedule -- the two functions can disagree about whether
-- the same row is still live. An hours edit is meant to apply going
-- forward, never to retroactively move an already-open day's deadline.
--
-- Fix: once a business_days row already exists for the date in
-- question, its own scheduled_open_time/scheduled_close_time -- not a
-- fresh special_hours/location_hours lookup -- is the window used to
-- decide whether "now" still falls inside it. Only fall back to
-- deriving fresh from hours config when no row exists yet for that
-- date (the normal "hasn't opened yet, still forming from config"
-- case) -- this also protects against a subtler failure the old
-- version had no defense against: a still-open day whose hours config
-- was later deleted entirely would previously read as `open_time is
-- null` and get silently treated as not-live even though it's
-- genuinely still open.
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
  select bd.* into v_day from public.business_days bd
  where bd.tenant_id = p_tenant_id and bd.location_id = p_location_id and bd.business_date = v_yesterday_date;

  if v_day.id is not null and v_day.scheduled_open_time is not null and v_day.scheduled_close_time is not null then
    v_hours.closed_all_day := false;
    v_hours.open_time := v_day.scheduled_open_time;
    v_hours.close_time := v_day.scheduled_close_time;
  else
    v_dow := extract(dow from v_yesterday_date);
    select
      coalesce(sh.is_closed, lh.closed_all_day, false) as closed_all_day,
      coalesce(sh.open_time, lh.open_time) as open_time,
      coalesce(sh.close_time, lh.close_time) as close_time
    into v_hours
    from (select 1) as _dummy
    left join public.special_hours sh on sh.location_id = p_location_id and sh.date = v_yesterday_date
    left join public.location_hours lh on lh.location_id = p_location_id and lh.day_of_week = v_dow;
  end if;

  if not v_hours.closed_all_day and v_hours.open_time is not null and v_hours.close_time is not null then
    v_open_at := (v_yesterday_date + v_hours.open_time) at time zone v_timezone;
    v_close_at := (v_yesterday_date + v_hours.close_time) at time zone v_timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    if v_now >= v_open_at and v_now < v_close_at then
      return query select v_yesterday_date, coalesce(v_day.status in ('open', 'reopened'), false), v_day.id;
      return;
    end if;
  end if;

  -- 2. Within TODAY's window?
  select bd.* into v_day from public.business_days bd
  where bd.tenant_id = p_tenant_id and bd.location_id = p_location_id and bd.business_date = v_local_date;

  if v_day.id is not null and v_day.scheduled_open_time is not null and v_day.scheduled_close_time is not null then
    v_hours.closed_all_day := false;
    v_hours.open_time := v_day.scheduled_open_time;
    v_hours.close_time := v_day.scheduled_close_time;
  else
    v_dow := extract(dow from v_local_date);
    select
      coalesce(sh.is_closed, lh.closed_all_day, false) as closed_all_day,
      coalesce(sh.open_time, lh.open_time) as open_time,
      coalesce(sh.close_time, lh.close_time) as close_time
    into v_hours
    from (select 1) as _dummy
    left join public.special_hours sh on sh.location_id = p_location_id and sh.date = v_local_date
    left join public.location_hours lh on lh.location_id = p_location_id and lh.day_of_week = v_dow;
  end if;

  if not v_hours.closed_all_day and v_hours.open_time is not null and v_hours.close_time is not null then
    v_open_at := (v_local_date + v_hours.open_time) at time zone v_timezone;
    v_close_at := (v_local_date + v_hours.close_time) at time zone v_timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    if v_now >= v_open_at and v_now < v_close_at then
      return query select v_local_date, coalesce(v_day.status in ('open', 'reopened'), false), v_day.id;
      return;
    end if;
  end if;

  -- 3. The gap between closing and the next opening (or no hours
  -- configured at all) -- default to the most recently CLOSED day that
  -- isn't dated in the future relative to "now" (0057).
  select bd.* into v_day from public.business_days bd
  where bd.tenant_id = p_tenant_id
    and bd.location_id = p_location_id
    and bd.status = 'closed'
    and bd.business_date <= v_local_date
  order by bd.business_date desc
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
