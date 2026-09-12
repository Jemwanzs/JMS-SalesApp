-- ============================================================================
-- 0078_correct_sale_date_in_place.sql
--
-- FEATURE ENHANCEMENT — CORRECT SALE DATE SWITCHING.
--
-- Supersedes migration 0077's approach to the date field specifically.
-- 0077 moved a sale's date via the SAME replacement-row mechanism every
-- other correctable field uses (new sale id, old row flips to
-- 'corrected'). The follow-up spec was explicit and repeated that this
-- is wrong for date changes: "must not create a new sale ID," "not
-- duplicated," "only ONE active sale record." Amount/quantity/product/
-- notes corrections are UNCHANGED here -- they still use the
-- replacement-row pattern (migration 0074), for consistency with
-- void/reverse and the audit trail they already provide. Only the DATE
-- field now updates the existing row in place.
--
-- Because the same Correct Sale dialog can change date alongside other
-- fields in one submission, correct_sale() now does this in two
-- sequential steps within the one transaction:
--   1. If amount/quantity/notes/product actually changed, run the
--      existing replacement-row correction exactly as before --
--      _apply_sale_correction reverts to its pre-0077 signature (no
--      date param) since date is no longer part of that mechanism.
--   2. Whichever row is now "the sale" (the original, if nothing else
--      changed; the fresh replacement, if something did) gets its
--      sale_date/business_day_id updated IN PLACE if the target date
--      differs -- same id, same sale_number, no new row -- via the new
--      _apply_sale_date_change().
-- This means the common case (only the date changes) preserves the
-- sale's identity exactly as the spec demands, while a combined
-- "wrong product AND wrong day" correction still ends up with exactly
-- one final open row carrying both fixes, not two half-applied ones.
--
-- Stock: for an in-place date change, there's no status transition to
-- trigger the existing reversal/re-deduction machinery (that trigger
-- fires on `update of status`, and status isn't changing here) -- and a
-- reversal-then-re-deduction pair would be the wrong shape anyway for a
-- row whose identity isn't changing. Instead, the sale's own existing
-- 'sale' stock_movements row (found by reference_id = the unchanged
-- sale id) has its `occurred_on` updated to match, directly. Same
-- movement row, same reference_id, just relocated to the new date --
-- exactly mirroring what's happening to the sale itself. No new
-- movement rows, no reversal pair, nothing left dangling on the old
-- date. A product/amount change still goes through the existing
-- reversal + fresh-deduction pair via the (unchanged) replacement-row
-- mechanism, before any date adjustment runs.
--
-- Reports/analytics continue to need zero changes -- they already query
-- `sales.sale_date` live (confirmed before writing migration 0077), and
-- an in-place UPDATE of that column is exactly as visible to them as an
-- INSERT of a new row with that column set.
-- ============================================================================

-- _apply_sale_correction reverts to its pre-0077 (migration 0074) 9-arg
-- signature -- date is no longer one of the fields it changes. The
-- 0077 10-arg version is dropped explicitly first (CREATE OR REPLACE
-- can't change a function's parameter list).
drop function if exists public._apply_sale_correction(public.sales, numeric, numeric, text, uuid, date, text, uuid, uuid, uuid);

create or replace function public._apply_sale_correction(
  p_sale public.sales,
  p_new_amount numeric,
  p_new_quantity numeric,
  p_new_notes text,
  p_new_product_id uuid,
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
  v_replacement_id uuid;
  v_product public.products;
begin
  select * into v_product from public.products where id = p_new_product_id and tenant_id = p_sale.tenant_id;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_product.is_system then
    raise exception 'Cannot correct a sale into the free-text "Others" product';
  end if;

  update public.sales set status = 'corrected' where id = p_sale.id;

  insert into public.sales (
    tenant_id, location_id, business_day_id, product_id,
    product_name_snapshot, product_image_snapshot, expected_price_snapshot,
    actual_amount, quantity, notes, recorded_by, sale_date, idempotency_key
  ) values (
    p_sale.tenant_id, p_sale.location_id, p_sale.business_day_id, v_product.id,
    v_product.name, v_product.image_url, v_product.expected_price,
    p_new_amount, p_new_quantity, p_new_notes, p_sale.recorded_by, p_sale.sale_date, gen_random_uuid()
  )
  returning id into v_replacement_id;

  insert into public.sale_corrections (
    tenant_id, sale_id, correction_type, old_values, new_values, reason,
    requested_by, approved_by, approval_request_id, replacement_sale_id
  ) values (
    p_sale.tenant_id, p_sale.id, 'correct', to_jsonb(p_sale),
    jsonb_build_object(
      'actual_amount', p_new_amount, 'quantity', p_new_quantity,
      'notes', p_new_notes, 'product_id', v_product.id
    ),
    p_reason, p_requested_by, p_approved_by, p_approval_request_id, v_replacement_id
  );

  return v_replacement_id;
end;
$$;

-- New: moves a sale's date IN PLACE -- same id, same sale_number, no
-- replacement row. `p_sale` is whichever row is currently "the sale" at
-- the point this is called (the original, or a same-transaction
-- replacement from an amount/product change that just ran).
create or replace function public._apply_sale_date_change(
  p_sale public.sales,
  p_new_sale_date date,
  p_reason text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_day public.business_days;
begin
  -- Resolve-or-create the business day for the target date -- identical
  -- logic/idempotency to migration 0077's (a day created here purely to
  -- host a backdated correction is 'closed', never 'open').
  select * into v_target_day
  from public.business_days
  where tenant_id = p_sale.tenant_id and location_id = p_sale.location_id and business_date = p_new_sale_date;

  if not found then
    insert into public.business_days (tenant_id, location_id, business_date, status, closed_at, closing_reason)
    values (
      p_sale.tenant_id, p_sale.location_id, p_new_sale_date, 'closed', now(),
      'Created automatically for a corrected sale date'
    )
    on conflict (tenant_id, location_id, business_date) do nothing;

    select * into v_target_day
    from public.business_days
    where tenant_id = p_sale.tenant_id and location_id = p_sale.location_id and business_date = p_new_sale_date;
  end if;

  -- Same row, same id, same sale_number -- just moved to the new day.
  update public.sales
  set sale_date = p_new_sale_date, business_day_id = v_target_day.id
  where id = p_sale.id;

  -- Relocate the sale's own stock ledger entry to match -- same
  -- movement row (reference_id never changes since the sale's own id
  -- didn't), just its date. No-op (0 rows) for an untracked product,
  -- which never had one to begin with.
  update public.stock_movements
  set occurred_on = p_new_sale_date
  where reference_type = 'sale' and reference_id = p_sale.id and movement_type = 'sale';

  insert into public.sale_corrections (
    tenant_id, sale_id, correction_type, old_values, new_values, reason, requested_by, approved_by
  ) values (
    p_sale.tenant_id, p_sale.id, 'correct',
    jsonb_build_object('sale_date', p_sale.sale_date, 'business_day_id', p_sale.business_day_id),
    jsonb_build_object('sale_date', p_new_sale_date, 'business_day_id', v_target_day.id),
    p_reason, p_actor, p_actor
  );
end;
$$;

create or replace function public.correct_sale(
  p_sale_id uuid,
  p_new_amount numeric,
  p_new_quantity numeric,
  p_new_notes text,
  p_new_product_id uuid,
  p_new_sale_date date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.sales;
  v_result_sale public.sales;
  v_actor uuid := auth.uid();
  v_edit_window_mode text;
  v_edit_window_hours int;
  v_day public.business_days;
  v_effective_date date;
  v_within_window boolean;
  v_requires_approval boolean;
  v_other_fields_changed boolean;
  v_approval_id uuid;
  v_replacement_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to correct a sale';
  end if;

  if p_new_amount is null or p_new_amount < 0 then
    raise exception 'A valid corrected amount is required';
  end if;

  if p_new_product_id is null then
    raise exception 'A product is required';
  end if;

  if p_new_sale_date is null then
    raise exception 'A sale date is required';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'open' then
    raise exception 'Sale is "%", not open -- it has already been voided, corrected, deleted, or reversed', v_sale.status;
  end if;

  -- Never a future date -- checked against the tenant/location's own
  -- EFFECTIVE business date (resolve_effective_business_date, migration
  -- 0055), not a raw current_date comparison.
  select business_date into v_effective_date
  from public.resolve_effective_business_date(v_sale.tenant_id, v_sale.location_id);

  if p_new_sale_date > v_effective_date then
    raise exception 'Cannot move a sale to a future date';
  end if;

  select coalesce(value #>> '{}', 'business_day') into v_edit_window_mode
  from public.tenant_settings
  where tenant_id = v_sale.tenant_id and setting_key = 'sale_edit_window_mode';
  v_edit_window_mode := coalesce(v_edit_window_mode, 'business_day');

  if v_actor <> v_sale.recorded_by then
    v_within_window := false;
  elsif v_edit_window_mode = 'hours' then
    select coalesce((value)::text::int, 2) into v_edit_window_hours
    from public.tenant_settings
    where tenant_id = v_sale.tenant_id and setting_key = 'sale_edit_window_hours';
    v_edit_window_hours := coalesce(v_edit_window_hours, 2);

    v_within_window := now() < v_sale.created_at + (v_edit_window_hours || ' hours')::interval;
  else
    if v_sale.business_day_id is null then
      v_within_window := false;
    else
      select * into v_day from public.business_days where id = v_sale.business_day_id;
      v_within_window := found and v_day.status in ('open', 'reopened');
    end if;
  end if;

  if v_within_window then
    if not public.has_permission(v_sale.tenant_id, 'sales.edit_window') then
      raise exception 'Not authorized to edit this sale';
    end if;
    v_requires_approval := false;
  else
    if not public.has_permission(v_sale.tenant_id, 'sales.correct_historical') then
      raise exception 'Not authorized to correct this sale -- the edit window has closed';
    end if;

    select coalesce((value)::text::boolean, false) into v_requires_approval
    from public.tenant_settings
    where tenant_id = v_sale.tenant_id and setting_key = 'sale_correction_requires_approval';
    v_requires_approval := coalesce(v_requires_approval, false);
  end if;

  insert into public.approval_requests (tenant_id, type, requested_by, request_payload, status)
  values (
    v_sale.tenant_id, 'sale_correction', v_actor,
    jsonb_build_object(
      'sale_id', p_sale_id, 'new_amount', p_new_amount, 'new_quantity', p_new_quantity,
      'new_notes', p_new_notes, 'new_product_id', p_new_product_id, 'new_sale_date', p_new_sale_date,
      'reason', p_reason
    ),
    case when v_requires_approval then 'pending' else 'auto_approved' end
  )
  returning id into v_approval_id;

  if v_requires_approval then
    return jsonb_build_object('status', 'pending_approval', 'approvalRequestId', v_approval_id);
  end if;

  -- Step 1: amount/quantity/notes/product go through the existing
  -- replacement-row mechanism, but ONLY if one of them actually changed
  -- -- a pure date-only correction must never spawn a redundant
  -- replacement row.
  v_other_fields_changed := (
    p_new_amount is distinct from v_sale.actual_amount
    or p_new_quantity is distinct from v_sale.quantity
    or p_new_notes is distinct from v_sale.notes
    or p_new_product_id is distinct from v_sale.product_id
  );

  if v_other_fields_changed then
    v_replacement_id := public._apply_sale_correction(
      v_sale, p_new_amount, p_new_quantity, p_new_notes, p_new_product_id, p_reason, v_actor, v_actor, v_approval_id
    );
    select * into v_result_sale from public.sales where id = v_replacement_id;
  else
    v_replacement_id := null;
    v_result_sale := v_sale;
  end if;

  -- Step 2: whichever row is now "the sale" gets its date moved in
  -- place, if it actually differs.
  if p_new_sale_date is distinct from v_result_sale.sale_date then
    perform public._apply_sale_date_change(v_result_sale, p_new_sale_date, p_reason, v_actor);
  end if;

  return jsonb_build_object(
    'status', 'corrected', 'approvalRequestId', v_approval_id, 'replacementSaleId', v_replacement_id
  );
end;
$$;

-- resolve_approval_request -- full create-or-replace (never edit an
-- already-applied migration). The sale_correction branch gets the same
-- two-step treatment as correct_sale() above; every other branch is
-- byte-for-byte identical to migration 0077's version.
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
  v_result_sale public.sales;
  v_day public.business_days;
  v_replacement_id uuid;
  v_other_fields_changed boolean;
  v_new_sale_date date;
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

    v_other_fields_changed := (
      (v_request.request_payload ->> 'new_amount')::numeric is distinct from v_sale.actual_amount
      or (v_request.request_payload ->> 'new_quantity')::numeric is distinct from v_sale.quantity
      or (v_request.request_payload ->> 'new_notes') is distinct from v_sale.notes
      or (v_request.request_payload ->> 'new_product_id')::uuid is distinct from v_sale.product_id
    );

    if v_other_fields_changed then
      v_replacement_id := public._apply_sale_correction(
        v_sale,
        (v_request.request_payload ->> 'new_amount')::numeric,
        (v_request.request_payload ->> 'new_quantity')::numeric,
        v_request.request_payload ->> 'new_notes',
        (v_request.request_payload ->> 'new_product_id')::uuid,
        v_request.request_payload ->> 'reason',
        v_request.requested_by, v_actor, v_request.id
      );
      select * into v_result_sale from public.sales where id = v_replacement_id;
    else
      v_replacement_id := null;
      v_result_sale := v_sale;
    end if;

    v_new_sale_date := (v_request.request_payload ->> 'new_sale_date')::date;
    if v_new_sale_date is not null and v_new_sale_date is distinct from v_result_sale.sale_date then
      perform public._apply_sale_date_change(
        v_result_sale, v_new_sale_date, v_request.request_payload ->> 'reason', v_actor
      );
    end if;

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

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke execute on function public._apply_sale_correction(public.sales, numeric, numeric, text, uuid, text, uuid, uuid, uuid) from public, authenticated;
revoke execute on function public._apply_sale_date_change(public.sales, date, text, uuid) from public, authenticated;

-- correct_sale's own signature (7 args, including p_new_sale_date) is
-- unchanged from migration 0077 -- no drop/re-grant needed for it.
