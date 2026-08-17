-- ============================================================================
-- 0017_geofencing_and_temporary_access.sql
--
-- Phase 4 (Enterprise Controls): geo-fencing + temporary-access-request
-- (docs/05-authentication-security.md's Geo-fencing / Temporary access
-- requests sections). Reuses the Approval Engine (migration 0006) as its
-- own spec calls for ("the Approval Engine's second consumer").
--
-- locations.lat/long/geofence_radius_m already exist (migration 0001) --
-- no location schema change needed here, only the new tracking table and
-- the request/resolve functions.
--
-- Design mirrors 0009's business-day-reopen precedent exactly: a
-- SECURITY DEFINER "request" function creates an approval_requests row
-- (always, per 0006's "always create the row" invariant) plus a row in
-- this migration's own tracking table; resolve_approval_request() gains
-- a fourth dispatch branch that applies the grant. Unlike void/correct/
-- reopen, this request type has NO auto-approve path -- the spec's
-- "admin approves/rejects" language never mentions an auto-approve
-- tenant setting the way the other three do, so every request always
-- goes to a human.
--
-- request_temporary_access() is called from a special, narrow window:
-- signInAction (features/auth/actions/sign-in.ts) signs in, evaluates
-- the access gate, and -- specifically when blocked by geofence rather
-- than working hours -- offers "Request Temporary Access" before tearing
-- the session back down; a *separate* server action re-authenticates
-- (email+password again, proving identity fresh) and calls this
-- function while that transient session is live, then signs out. This
-- reuses the exact sign-in/check/sign-out lifecycle already established
-- for 4e rather than inventing a new one.
-- ============================================================================

create table public.temporary_access_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  approval_request_id uuid not null references public.approval_requests (id),
  profile_id uuid not null references public.profiles (id),
  reason text not null,
  current_latitude double precision,
  current_longitude double precision,
  requested_duration_minutes integer not null,
  granted_until timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now()
);

create index idx_temporary_access_requests_tenant on public.temporary_access_requests (tenant_id);
-- The gate's active-grant lookup filters on exactly these four columns.
create index idx_temporary_access_requests_active_grant
  on public.temporary_access_requests (profile_id, tenant_id, status, granted_until);

alter table public.temporary_access_requests enable row level security;

create policy temporary_access_requests_select on public.temporary_access_requests
for select to authenticated
using (
  profile_id = auth.uid()
  or public.has_permission(tenant_id, 'approvals.manage')
);

-- No insert/update policy: written exclusively by the SECURITY DEFINER
-- functions below, same posture as approval_requests itself.

-- ============================================================================
-- request_temporary_access -- the blocked user's escape hatch. Runs
-- under the caller's own (transiently re-established) session, so
-- auth.uid() identifies the requester the same way every other
-- request-side function in the approval engine does.
-- ============================================================================

create or replace function public.request_temporary_access(
  p_tenant_id uuid,
  p_reason text,
  p_current_latitude double precision,
  p_current_longitude double precision,
  p_duration_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_approval_id uuid;
  v_request_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to request temporary access';
  end if;

  if p_duration_minutes is null or p_duration_minutes <= 0 or p_duration_minutes > 720 then
    raise exception 'Requested duration must be between 1 minute and 12 hours';
  end if;

  if not public.is_tenant_member(p_tenant_id) then
    raise exception 'Not a member of this tenant';
  end if;

  insert into public.approval_requests (tenant_id, type, requested_by, request_payload, status)
  values (
    p_tenant_id, 'temporary_location_access', v_actor,
    jsonb_build_object('reason', p_reason, 'duration_minutes', p_duration_minutes),
    'pending'
  )
  returning id into v_approval_id;

  insert into public.temporary_access_requests (
    tenant_id, approval_request_id, profile_id, reason,
    current_latitude, current_longitude, requested_duration_minutes, status
  )
  values (
    p_tenant_id, v_approval_id, v_actor, p_reason,
    p_current_latitude, p_current_longitude, p_duration_minutes, 'pending'
  )
  returning id into v_request_id;

  return jsonb_build_object(
    'status', 'pending_approval',
    'approvalRequestId', v_approval_id,
    'requestId', v_request_id
  );
end;
$$;

revoke execute on function public.request_temporary_access(uuid, text, double precision, double precision, integer) from public;
grant execute on function public.request_temporary_access(uuid, text, double precision, double precision, integer) to authenticated;

-- ============================================================================
-- _apply_temporary_access_grant -- internal, not directly callable (see
-- grants below), same posture as _apply_business_day_reopen.
-- ============================================================================

create or replace function public._apply_temporary_access_grant(
  p_request public.temporary_access_requests,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.temporary_access_requests
  set status = 'approved',
      granted_until = now() + (p_request.requested_duration_minutes || ' minutes')::interval
  where id = p_request.id;
end;
$$;

revoke execute on function public._apply_temporary_access_grant(public.temporary_access_requests, uuid) from public, authenticated;

-- ============================================================================
-- resolve_approval_request() gains a fourth dispatch branch. Full
-- create-or-replace of the migration-0006/0009 function, not an edit to
-- either already-applied migration -- the three existing branches are
-- byte-for-byte unchanged. Also teaches the shared "rejected" path to
-- flip this request type's own tracking row, since (unlike sale_void/
-- sale_correction/business_day_reopen) a rejection here leaves a
-- pending temporary_access_requests row that nothing else would ever
-- update otherwise.
-- ============================================================================

create or replace function public.resolve_approval_request(
  p_id uuid,
  p_decision text,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.approval_requests;
  v_actor uuid := auth.uid();
  v_sale public.sales;
  v_day public.business_days;
  v_tar public.temporary_access_requests;
  v_replacement_id uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be "approved" or "rejected"';
  end if;

  select * into v_request from public.approval_requests where id = p_id for update;
  if not found then
    raise exception 'Approval request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Approval request is "%", not pending', v_request.status;
  end if;

  if not public.has_permission(v_request.tenant_id, 'approvals.manage') then
    raise exception 'Not authorized to review approval requests';
  end if;

  update public.approval_requests
  set status = p_decision, reviewed_by = v_actor, reviewed_at = now(), review_notes = p_notes
  where id = p_id;

  if p_decision = 'rejected' then
    if v_request.type = 'temporary_location_access' then
      update public.temporary_access_requests
      set status = 'rejected'
      where approval_request_id = v_request.id;
    end if;
    return jsonb_build_object('status', 'rejected');
  end if;

  if v_request.type = 'sale_void' then
    select * into v_sale from public.sales where id = (v_request.request_payload ->> 'sale_id')::uuid for update;
    if not found or v_sale.status <> 'open' then
      raise exception 'Sale is no longer in a voidable state';
    end if;
    perform public._apply_sale_void(
      v_sale, v_request.request_payload ->> 'reason', v_request.requested_by, v_actor, v_request.id
    );
    return jsonb_build_object('status', 'approved', 'type', v_request.type);
  elsif v_request.type = 'sale_correction' then
    select * into v_sale from public.sales where id = (v_request.request_payload ->> 'sale_id')::uuid for update;
    if not found or v_sale.status <> 'open' then
      raise exception 'Sale is no longer in a correctable state';
    end if;
    v_replacement_id := public._apply_sale_correction(
      v_sale,
      (v_request.request_payload ->> 'new_amount')::numeric,
      (v_request.request_payload ->> 'new_quantity')::numeric,
      v_request.request_payload ->> 'new_notes',
      v_request.request_payload ->> 'reason',
      v_request.requested_by, v_actor, v_request.id
    );
    return jsonb_build_object('status', 'approved', 'type', v_request.type, 'replacementSaleId', v_replacement_id);
  elsif v_request.type = 'business_day_reopen' then
    select * into v_day from public.business_days where id = (v_request.request_payload ->> 'business_day_id')::uuid for update;
    if not found or v_day.status <> 'closed' then
      raise exception 'Business day is no longer in a reopenable state';
    end if;
    perform public._apply_business_day_reopen(
      v_day, (v_request.request_payload ->> 'until')::timestamptz, v_actor
    );
    return jsonb_build_object('status', 'approved', 'type', v_request.type);
  elsif v_request.type = 'temporary_location_access' then
    select * into v_tar from public.temporary_access_requests where approval_request_id = v_request.id for update;
    if not found or v_tar.status <> 'pending' then
      raise exception 'Temporary access request is no longer pending';
    end if;
    perform public._apply_temporary_access_grant(v_tar, v_actor);
    return jsonb_build_object('status', 'approved', 'type', v_request.type);
  else
    raise exception 'Unknown approval request type: %', v_request.type;
  end if;
end;
$$;

-- ============================================================================
-- run_business_day_sweep() gains one more pass: expiring granted
-- temporary-access windows, "the same scheduled sweep used for business
-- day reopen" the spec calls for. Full create-or-replace of migration
-- 0011's function -- the business-day scheduling/opening/closing/relock
-- logic above the new pass is byte-for-byte unchanged. The gate itself
-- (AuthService.evaluateAccessGate) already filters on granted_until >
-- now() dynamically, so this pass is bookkeeping/audit-trail accuracy
-- (a stale "approved" row reads correctly as "expired"), not something
-- the gate's correctness depends on.
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
