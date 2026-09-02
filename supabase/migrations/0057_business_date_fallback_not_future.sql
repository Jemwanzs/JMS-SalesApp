-- ============================================================================
-- 0057_business_date_fallback_not_future.sql
--
-- Live-verification of 0055/0056 surfaced a second real bug:
-- resolve_effective_business_date()'s gap-period fallback (step 3 --
-- "no live window right now, default to the most recently completed
-- business day") picked `order by business_date desc limit 1` over ALL
-- `closed` rows for the location, with no upper bound. A `business_days`
-- row dated AFTER real "now" but already marked 'closed' -- which
-- shouldn't normally exist for a real tenant (the sweep never creates a
-- row for a date it hasn't reached yet), but can via a malformed/manual
-- edit, a migrated dataset, or (as caught live here) a demo tenant
-- seeded with a full future-dated period for richness -- would win that
-- ordering and get reported as "the most recently completed business
-- day," which is meaningless for a date that, from "now"'s perspective,
-- hasn't happened yet.
--
-- Fix: bound the fallback to `business_date <= v_local_date`. Doesn't
-- change behavior for any well-formed tenant (the sweep only ever
-- closes rows dated today or earlier), only prevents trusting a
-- closed-but-future row as if it were history.
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
  -- configured at all) -- default to the most recently CLOSED day that
  -- isn't dated in the future relative to "now" (0057: a closed row
  -- dated after today isn't "the most recently completed business day"
  -- by definition, however it came to exist).
  select * into v_day from public.business_days
  where tenant_id = p_tenant_id
    and location_id = p_location_id
    and status = 'closed'
    and business_date <= v_local_date
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
