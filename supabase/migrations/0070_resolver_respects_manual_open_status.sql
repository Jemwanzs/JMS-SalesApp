-- ============================================================================
-- 0070_resolver_respects_manual_open_status.sql
--
-- Real production bug, confirmed live on two independent tenants:
-- resolve_effective_business_date() (0055, redefined through 0061) has
-- always decided "is today/yesterday live" purely from a computed
-- schedule window (business_date + scheduled_open_time/close_time vs.
-- now()) -- it never checked whether the row's own `status` had already
-- been manually set to 'open'/'reopened'. A manual Open/Reopen that
-- happens BEFORE the scheduled window starts (e.g. opening at 03:28 for
-- a day scheduled to open at 07:00) was therefore invisible to every
-- caller: getTodayBusinessDay() (canCapture on the Sales page),
-- getEffectiveBusinessDate() (every other page's "today" default), all
-- silently treated the day as not-live despite the database saying
-- status='open' -- there was no code path that ever surfaced this,
-- because the schedule window is where every prior fix in this series
-- (0055-0061) was aimed at (cross-midnight extension, the closed/gap
-- period, a stale future-dated seed row) -- none of them touched the
-- case where a REAL row already exists and has already been manually
-- opened outside its own window.
--
-- Fix: for both the yesterday-extension check and today's-window check,
-- short-circuit BEFORE any schedule-window math -- if a row already
-- exists for that date and its status is already 'open' or 'reopened',
-- that is definitive; return it as live immediately. The schedule
-- window still governs everything it always did for a day nobody has
-- manually touched yet (deciding whether the sweep should auto-open it,
-- and which date a brand-new sale should be attributed to before any
-- row exists) -- this only changes what happens once a human has
-- already made the explicit call to open it.
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

  -- 1. Still within YESTERDAY's window, extended past midnight? -- or
  -- already manually opened/reopened regardless of the clock (0070).
  select bd.* into v_day from public.business_days bd
  where bd.tenant_id = p_tenant_id and bd.location_id = p_location_id and bd.business_date = v_yesterday_date;

  if v_day.id is not null and v_day.status in ('open', 'reopened') then
    return query select v_yesterday_date, true, v_day.id;
    return;
  end if;

  -- Frozen schedule (0059) is only trustworthy once a day has actually
  -- been OPENED at some point -- protecting an in-progress/already-open
  -- day's deadline from a later hours edit is the whole point of that
  -- rule. A 'scheduled' placeholder (auto-created by the sweep the
  -- moment its date is known, see run_business_day_sweep()'s own header
  -- comment) hasn't started anything yet, so there is nothing to protect
  -- -- preferring its frozen fields there only fossilizes whatever hours
  -- happened to exist at that creation instant, disagreeing with the
  -- sweep itself (which always re-reads hours fresh, see 0065's loop)
  -- the moment a tenant edits hours after the placeholder exists but
  -- before the day actually opens (0070).
  if v_day.id is not null and v_day.status <> 'scheduled' and v_day.scheduled_open_time is not null and v_day.scheduled_close_time is not null then
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

  -- 2. Within TODAY's window? -- or already manually opened/reopened
  -- regardless of the clock (0070) -- this is the case that broke both
  -- live-verified tenants: a manual open before the scheduled start.
  select bd.* into v_day from public.business_days bd
  where bd.tenant_id = p_tenant_id and bd.location_id = p_location_id and bd.business_date = v_local_date;

  if v_day.id is not null and v_day.status in ('open', 'reopened') then
    return query select v_local_date, true, v_day.id;
    return;
  end if;

  -- Same "frozen schedule only trustworthy once actually opened" rule
  -- as case 1 above -- see that block's comment (0070).
  if v_day.id is not null and v_day.status <> 'scheduled' and v_day.scheduled_open_time is not null and v_day.scheduled_close_time is not null then
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
  -- bounded by its own closed_at instant actually having passed (0061).
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
