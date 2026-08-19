-- ============================================================================
-- 0026_sale_reversal.sql
--
-- REVERSE, the third documented sale-mutation type (docs/08-sales-
-- engine.md: "VOID / CORRECT / REVERSE"), deliberately deferred by
-- migration 0006's own header comment ("VOID and CORRECT cover the two
-- real-world cases this phase targets; REVERSE is a documented future
-- increment, not silently dropped").
--
-- Design (an offsetting entry, the standard accounting meaning of
-- "reversing entry" -- explicit product decision, since the spec's own
-- one-line description, "same pattern for reversing entries," doesn't
-- otherwise disambiguate this from a relabeled VOID): the ORIGINAL sale
-- is never deleted or amount-edited -- it flips to a new 'reversed'
-- status (same "status transition, never DELETE" principle every other
-- mutation in this app follows) and a NEW sale row is inserted with the
-- NEGATIVE of the original amount, linked back via the new
-- reversal_of_sale_id column. Both rows stay fully visible in sales
-- history. The real payoff: every existing gross-sales aggregate already
-- does sum(actual_amount) -- a reversed pair nets to zero automatically,
-- with no aggregation logic to touch anywhere in the app for this to be
-- correct.
--
-- While making that "both rows count" claim, a real pre-existing bug
-- surfaced by code review (not part of the original ask, confirmed with
-- the user before fixing here): every gross-sales aggregate query
-- (AnalyticsService, BusinessDayService, ImportService, InsightsService,
-- PlatformAdminService, ReportService) filters .neq('status','voided')
-- but never excludes 'corrected' -- so a corrected sale's ORIGINAL
-- amount has been double-counted alongside its replacement's new amount
-- since Phase 2e shipped. Fixed in the same application-code pass this
-- migration ships with (no SQL change needed for that fix -- it's a
-- second .neq() at each of the 6 call sites). 'reversed' must NOT be
-- added to that same exclusion list -- a reversed original's amount is
-- still real and needs to keep counting, exactly offset by its new
-- negative row, which is the whole point of an offsetting entry.
--
-- sale_status gains 'reversed' (Postgres requires ALTER TYPE ... ADD
-- VALUE to run before it's referenced elsewhere in the same
-- transaction, which is why it's the very first statement here).
-- ============================================================================

alter type public.sale_status add value 'reversed';

alter table public.sales add column reversal_of_sale_id uuid references public.sales (id);

-- Only a reversal row may carry a negative amount -- every other insert
-- path (recordSale, _apply_sale_correction) is untouched and still
-- produces non-negative amounts, so this is a strict widening of the
-- existing constraint, not a loosening of it for ordinary sales.
--
-- migration 0005 never named this constraint explicitly, so it carries
-- whatever name Postgres auto-generated -- looked up dynamically here
-- (via pg_constraint/pg_get_constraintdef) rather than hardcoding a
-- guessed name, so this doesn't silently no-op if the real name ever
-- turns out to differ from Postgres's usual `{table}_{column}_check`
-- convention.
do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.sales'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%actual_amount%';

  if v_conname is not null then
    execute format('alter table public.sales drop constraint %I', v_conname);
  end if;
end $$;

alter table public.sales add constraint sales_actual_amount_check
  check (actual_amount >= 0 or reversal_of_sale_id is not null);

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'public.sale_corrections'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%correction_type%';

  if v_conname is not null then
    execute format('alter table public.sale_corrections drop constraint %I', v_conname);
  end if;
end $$;

alter table public.sale_corrections add constraint sale_corrections_correction_type_check
  check (correction_type in ('void', 'correct', 'reverse'));

insert into public.permissions (key, module, description, is_read_only) values
  ('sales.reverse', 'sales', 'Reverse a sale with an offsetting entry', false);

-- ============================================================================
-- _apply_sale_reversal -- same internal-only posture as _apply_sale_void/
-- _apply_sale_correction (never granted to authenticated, only callable
-- from within a SECURITY DEFINER function above it in the call chain).
-- ============================================================================

create or replace function public._apply_sale_reversal(
  p_sale public.sales,
  p_reason text,
  p_requested_by uuid,
  p_approved_by uuid,
  p_approval_request_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reversal_id uuid;
begin
  update public.sales set status = 'reversed' where id = p_sale.id;

  insert into public.sales (
    tenant_id, location_id, business_day_id, product_id,
    product_name_snapshot, product_image_snapshot, expected_price_snapshot,
    actual_amount, quantity, notes, recorded_by, sale_date, idempotency_key,
    reversal_of_sale_id
  ) values (
    p_sale.tenant_id, p_sale.location_id, p_sale.business_day_id, p_sale.product_id,
    p_sale.product_name_snapshot, p_sale.product_image_snapshot, p_sale.expected_price_snapshot,
    -p_sale.actual_amount, p_sale.quantity, p_reason, p_sale.recorded_by, p_sale.sale_date, gen_random_uuid(),
    p_sale.id
  )
  returning id into v_reversal_id;

  insert into public.sale_corrections (
    tenant_id, sale_id, correction_type, old_values, new_values, reason,
    requested_by, approved_by, approval_request_id, replacement_sale_id
  ) values (
    p_sale.tenant_id, p_sale.id, 'reverse', to_jsonb(p_sale),
    jsonb_build_object('actual_amount', -p_sale.actual_amount, 'reversal_of_sale_id', p_sale.id),
    p_reason, p_requested_by, p_approved_by, p_approval_request_id, v_reversal_id
  );

  return v_reversal_id;
end;
$$;

create or replace function public.reverse_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.sales;
  v_actor uuid := auth.uid();
  v_requires_approval boolean;
  v_approval_id uuid;
  v_reversal_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reverse a sale';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'open' then
    raise exception 'Sale is "%", not open -- it has already been voided, corrected, or reversed', v_sale.status;
  end if;

  if not public.has_permission(v_sale.tenant_id, 'sales.reverse') then
    raise exception 'Not authorized to reverse sales';
  end if;

  select coalesce((value)::text::boolean, false) into v_requires_approval
  from public.tenant_settings
  where tenant_id = v_sale.tenant_id and setting_key = 'sale_reversal_requires_approval';
  v_requires_approval := coalesce(v_requires_approval, false);

  insert into public.approval_requests (tenant_id, type, requested_by, request_payload, status)
  values (
    v_sale.tenant_id, 'sale_reversal', v_actor,
    jsonb_build_object('sale_id', p_sale_id, 'reason', p_reason),
    case when v_requires_approval then 'pending' else 'auto_approved' end
  )
  returning id into v_approval_id;

  if v_requires_approval then
    return jsonb_build_object('status', 'pending_approval', 'approvalRequestId', v_approval_id);
  end if;

  v_reversal_id := public._apply_sale_reversal(v_sale, p_reason, v_actor, v_actor, v_approval_id);

  return jsonb_build_object('status', 'reversed', 'approvalRequestId', v_approval_id, 'replacementSaleId', v_reversal_id);
end;
$$;

revoke execute on function public.reverse_sale(uuid, text) from public;
grant execute on function public.reverse_sale(uuid, text) to authenticated;

revoke execute on function public._apply_sale_reversal(public.sales, text, uuid, uuid, uuid) from public, authenticated;

-- ============================================================================
-- resolve_approval_request gains a fourth dispatch branch. Full create-
-- or-replace (never edit an already-applied migration file -- see
-- docs/20-development-progress.md) -- the three existing branches are
-- byte-for-byte unchanged from migration 0009's version.
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
  elsif v_request.type = 'sale_reversal' then
    select * into v_sale from public.sales where id = (v_request.request_payload ->> 'sale_id')::uuid for update;
    if not found or v_sale.status <> 'open' then
      raise exception 'Sale is no longer in a reversible state';
    end if;
    v_replacement_id := public._apply_sale_reversal(
      v_sale, v_request.request_payload ->> 'reason', v_request.requested_by, v_actor, v_request.id
    );
    return jsonb_build_object('status', 'approved', 'type', v_request.type, 'replacementSaleId', v_replacement_id);
  else
    raise exception 'Unknown approval request type: %', v_request.type;
  end if;
end;
$$;
