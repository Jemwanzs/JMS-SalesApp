-- ============================================================================
-- 0061_business_date_fallback_by_closed_at.sql
--
-- Live browser verification surfaced one more real gap in the gap-
-- period fallback (step 3): bounding it by `business_date <= v_local_date`
-- (0057) still let through a `closed` row whose `business_date` equals
-- today but whose own `closed_at` timestamp is still in the future
-- relative to real "now" -- exactly what this demo tenant's seed data
-- has (today's row pre-marked closed at 23:55, viewed live at 1am). A
-- real tenant's sweep can never produce that (it only ever flips a row
-- to 'closed' once `now() >= its close deadline`), so this can't happen
-- from genuine app usage -- but the fallback shouldn't trust it if it
-- exists regardless of how.
--
-- `business_date` is a calendar label; `closed_at` is the actual
-- instant the day finished. The correctness criterion for "has this
-- business day genuinely, verifiably concluded as of right now" is
-- `closed_at <= now()`, not a date comparison -- strictly more precise,
-- and it subsumes 0057's `business_date <= v_local_date` bound (any row
-- with closed_at in the past necessarily has a business_date at or
-- before today).
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
  v_closed_all_day boolean;
  v_open_time time;
  v_close_time time;
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
    v_closed_all_day := false;
    v_open_time := v_day.scheduled_open_time;
    v_close_time := v_day.scheduled_close_time;
  else
    v_dow := extract(dow from v_yesterday_date);
    select
      coalesce(sh.is_closed, lh.closed_all_day, false),
      coalesce(sh.open_time, lh.open_time),
      coalesce(sh.close_time, lh.close_time)
    into v_closed_all_day, v_open_time, v_close_time
    from (select 1) as _dummy
    left join public.special_hours sh on sh.location_id = p_location_id and sh.date = v_yesterday_date
    left join public.location_hours lh on lh.location_id = p_location_id and lh.day_of_week = v_dow;
  end if;

  if not coalesce(v_closed_all_day, false) and v_open_time is not null and v_close_time is not null then
    v_open_at := (v_yesterday_date + v_open_time) at time zone v_timezone;
    v_close_at := (v_yesterday_date + v_close_time) at time zone v_timezone;
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
    v_closed_all_day := false;
    v_open_time := v_day.scheduled_open_time;
    v_close_time := v_day.scheduled_close_time;
  else
    v_dow := extract(dow from v_local_date);
    select
      coalesce(sh.is_closed, lh.closed_all_day, false),
      coalesce(sh.open_time, lh.open_time),
      coalesce(sh.close_time, lh.close_time)
    into v_closed_all_day, v_open_time, v_close_time
    from (select 1) as _dummy
    left join public.special_hours sh on sh.location_id = p_location_id and sh.date = v_local_date
    left join public.location_hours lh on lh.location_id = p_location_id and lh.day_of_week = v_dow;
  end if;

  if not coalesce(v_closed_all_day, false) and v_open_time is not null and v_close_time is not null then
    v_open_at := (v_local_date + v_open_time) at time zone v_timezone;
    v_close_at := (v_local_date + v_close_time) at time zone v_timezone;
    if v_close_at <= v_open_at then
      v_close_at := v_close_at + interval '1 day';
    end if;

    if v_now >= v_open_at and v_now < v_close_at then
      return query select v_local_date, coalesce(v_day.status in ('open', 'reopened'), false), v_day.id;
      return;
    end if;
  end if;

  -- 3. The gap between closing and the next opening (or no hours
  -- configured at all) -- default to the most recently CLOSED day,
  -- bounded by its own closed_at instant actually having passed (0061)
  -- -- a business_date label alone (0057) isn't precise enough to rule
  -- out a malformed/synthetic row dated today but not yet due to close.
  select bd.* into v_day from public.business_days bd
  where bd.tenant_id = p_tenant_id
    and bd.location_id = p_location_id
    and bd.status = 'closed'
    and bd.closed_at is not null
    and bd.closed_at <= v_now
  order by bd.closed_at desc
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
