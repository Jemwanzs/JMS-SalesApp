-- ============================================================================
-- 0009_business_day_reopen.sql
--
-- Phase 2h, scoped per explicit decision (docs/20-development-progress.md):
-- reason + optional approval (reusing the 2g engine), NO MFA yet -- MFA
-- doesn't exist until Phase 4, and this flow's shape doesn't need to
-- change when it lands (MFA becomes an extra gate in front of the same
-- reopen_business_day() call, not a redesign).
--
-- No new tables/columns: business_days already has reopened_at/
-- reopened_by/reopen_expires_at (migration 0005); the reason lives in the
-- approval_requests row (same pattern as void_sale/correct_sale, which
-- don't have a dedicated "reason" column on `sales` either) -- that row,
-- immutable once written, IS the audit record docs/09-business-day-engine.md
-- asks for.
--
-- The bounded "Reopen until: HH:MM" window auto-relocks LAZILY (checked by
-- BusinessDayService.getTodayBusinessDay() on every read) rather than via
-- pg_cron, since 2f's sweep isn't built yet. auto_relock_expired_business_day()
-- is deliberately NOT permission-gated -- relocking is a system consequence
-- of time passing, not a privileged action the caller is choosing to take,
-- so a plain Sales User's read during sale capture can still trigger it
-- (same reasoning as assign_sale_number() running as table owner
-- regardless of who's inserting). Once 2f's sweep exists it can call this
-- same function proactively; this migration doesn't need to change then.
-- ============================================================================

create or replace function public.reopen_business_day(
  p_business_day_id uuid,
  p_reason text,
  p_until timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day public.business_days;
  v_actor uuid := auth.uid();
  v_requires_approval boolean;
  v_approval_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reopen a business day';
  end if;

  if p_until is null or p_until <= now() then
    raise exception 'Reopen-until must be a future time';
  end if;

  if p_until > now() + interval '12 hours' then
    raise exception 'Reopen-until cannot be more than 12 hours from now';
  end if;

  select * into v_day from public.business_days where id = p_business_day_id for update;
  if not found then
    raise exception 'Business day not found';
  end if;

  if v_day.status <> 'closed' then
    raise exception 'Business day is "%", not closed -- only a closed day can be reopened', v_day.status;
  end if;

  if not public.has_permission(v_day.tenant_id, 'business_day.reopen') then
    raise exception 'Not authorized to reopen business days';
  end if;

  select coalesce((value)::text::boolean, false) into v_requires_approval
  from public.tenant_settings
  where tenant_id = v_day.tenant_id and setting_key = 'business_day_reopen_requires_approval';
  v_requires_approval := coalesce(v_requires_approval, false);

  insert into public.approval_requests (tenant_id, type, requested_by, request_payload, status)
  values (
    v_day.tenant_id, 'business_day_reopen', v_actor,
    jsonb_build_object('business_day_id', p_business_day_id, 'reason', p_reason, 'until', p_until),
    case when v_requires_approval then 'pending' else 'auto_approved' end
  )
  returning id into v_approval_id;

  if v_requires_approval then
    return jsonb_build_object('status', 'pending_approval', 'approvalRequestId', v_approval_id);
  end if;

  perform public._apply_business_day_reopen(v_day, p_until, v_actor);

  return jsonb_build_object('status', 'reopened', 'approvalRequestId', v_approval_id);
end;
$$;

create or replace function public._apply_business_day_reopen(
  p_day public.business_days,
  p_until timestamptz,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.business_days
  set status = 'reopened',
      reopened_at = now(),
      reopened_by = p_actor,
      reopen_expires_at = p_until
  where id = p_day.id;
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

  return jsonb_build_object('status', 'closed', 'relocked', true);
end;
$$;

revoke execute on function public.reopen_business_day(uuid, text, timestamptz) from public;
grant execute on function public.reopen_business_day(uuid, text, timestamptz) to authenticated;

-- Deliberately granted broadly (see header) -- not gated to a specific
-- permission, unlike every other function in this file.
revoke execute on function public.auto_relock_expired_business_day(uuid) from public;
grant execute on function public.auto_relock_expired_business_day(uuid) to authenticated;

revoke execute on function public._apply_business_day_reopen(public.business_days, timestamptz, uuid) from public, authenticated;

-- ============================================================================
-- resolve_approval_request() gains a third dispatch branch. This is a
-- full create-or-replace of the migration-0006 function, not an edit to
-- that migration file (never touch an already-applied migration -- see
-- docs/20-development-progress.md) -- the two existing branches are
-- byte-for-byte unchanged.
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
  else
    raise exception 'Unknown approval request type: %', v_request.type;
  end if;
end;
$$;
