-- ============================================================================
-- 0077_correct_sale_date.sql
--
-- FEATURE ENHANCEMENT — CORRECT SALE DATE.
--
-- Extends Correct Sale (already able to change product/amount/quantity/
-- notes, migration 0074) to also move a sale's business date -- today,
-- or any earlier date, never a future one. Uses the exact same
-- replacement-row mechanism every other correctable field already uses:
-- the old row flips to 'corrected', a brand-new row is inserted carrying
-- the new value(s), linked via sale_corrections.replacement_sale_id.
-- `created_at` is never touched -- only the replacement row's own fresh
-- `created_at` exists; the old row's is untouched.
--
-- No new permission -- sale date is just another field `correct_sale()`
-- can change, gated by the exact same sales.edit_window (self-serve,
-- within window) / sales.correct_historical (bypass window, possibly
-- approval-routed) logic already governing every other field. No new
-- "locked period" concept either -- none exists anywhere in this
-- codebase today (confirmed via full-repo search before writing this),
-- and inventing one is out of scope for enhancing an existing flow;
-- sales.correct_historical + the existing sale_correction_requires_
-- approval routing is the closest existing analogue and is left
-- completely unchanged.
--
-- Everything downstream of the replacement row's own `sale_date`
-- already works with ZERO further changes, confirmed by reading the
-- actual trigger/query code before writing this migration:
--   - stock_movements.occurred_on is copied from `new.sale_date` at
--     trigger-fire time (latest insert trigger: migration 0072; restore
--     trigger body unchanged since 0067) -- the replacement row's insert
--     naturally deducts stock dated to the NEW day, while the old row's
--     status-change to 'corrected' naturally restores stock dated to
--     the OLD day, via the exact same triggers already in place.
--   - The stock idempotency unique index (migration 0067) is keyed by
--     (tenant_id, product_id, reference_id, movement_type) -- no date,
--     no amount -- so it can never conflict across the old and new sale
--     IDs regardless of what changed between them.
--   - Reports/analytics/insights all query `sales.sale_date` /
--     `stock_movements.occurred_on` live at read time with the standard
--     status exclusions already in place -- no cached per-date
--     aggregate exists anywhere in that path to go stale.
--
-- The one genuine gap: no existing helper resolves-or-creates a
-- business_days row for an arbitrary PAST date (every BusinessDayService
-- method is hardcoded to "today"). _apply_sale_correction now does this
-- inline, mirroring BusinessDayService.openDay's own insert shape --
-- minus making the day live: a business day materialized purely to host
-- a corrected sale is created 'closed', never 'open', so it can't
-- become newly capturable for fresh sales. Race-safe via the same
-- idempotent-insert idiom already used for stock_movements/report_jobs
-- (on conflict on business_days' own existing (tenant_id, location_id,
-- business_date) unique constraint from migration 0005, do nothing,
-- then re-select).
--
-- The "never future" check uses resolve_effective_business_date()
-- (migration 0055) -- the SAME centralized business-date logic
-- SalesService.recordSale's own resolution chain is built on -- not a
-- raw current_date comparison, per the feature's own explicit
-- requirement to respect business-day rollover rather than simply
-- compare calendar timestamps.
-- ============================================================================

-- correct_sale's old 6-arg signature is dropped explicitly first --
-- CREATE OR REPLACE would otherwise leave it callable alongside the new
-- 7-arg one (Postgres treats a different parameter list as a distinct
-- function), the same ambiguity migration 0074 avoided when adding the
-- product param.
drop function if exists public.correct_sale(uuid, numeric, numeric, text, uuid, text);

create or replace function public._apply_sale_correction(
  p_sale public.sales,
  p_new_amount numeric,
  p_new_quantity numeric,
  p_new_notes text,
  p_new_product_id uuid,
  p_new_sale_date date,
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
  v_target_day public.business_days;
begin
  select * into v_product from public.products where id = p_new_product_id and tenant_id = p_sale.tenant_id;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_product.is_system then
    raise exception 'Cannot correct a sale into the free-text "Others" product';
  end if;

  -- Resolve-or-create the business day for the target date. A day
  -- created here purely to host a backdated correction is 'closed', not
  -- 'open' -- it must never become newly capturable for fresh sales
  -- just because a correction happened to land on it. Idempotent-insert
  -- (on conflict on the existing (tenant_id, location_id, business_date)
  -- unique constraint, migration 0005) + re-select handles the
  -- vanishingly unlikely concurrent-creation race the same way
  -- stock_movements/report_jobs already do elsewhere in this codebase.
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

  update public.sales set status = 'corrected' where id = p_sale.id;

  insert into public.sales (
    tenant_id, location_id, business_day_id, product_id,
    product_name_snapshot, product_image_snapshot, expected_price_snapshot,
    actual_amount, quantity, notes, recorded_by, sale_date, idempotency_key
  ) values (
    p_sale.tenant_id, p_sale.location_id, v_target_day.id, v_product.id,
    v_product.name, v_product.image_url, v_product.expected_price,
    p_new_amount, p_new_quantity, p_new_notes, p_sale.recorded_by, p_new_sale_date, gen_random_uuid()
  )
  returning id into v_replacement_id;

  insert into public.sale_corrections (
    tenant_id, sale_id, correction_type, old_values, new_values, reason,
    requested_by, approved_by, approval_request_id, replacement_sale_id
  ) values (
    p_sale.tenant_id, p_sale.id, 'correct', to_jsonb(p_sale),
    jsonb_build_object(
      'actual_amount', p_new_amount, 'quantity', p_new_quantity,
      'notes', p_new_notes, 'product_id', v_product.id, 'sale_date', p_new_sale_date
    ),
    p_reason, p_requested_by, p_approved_by, p_approval_request_id, v_replacement_id
  );

  return v_replacement_id;
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
  v_actor uuid := auth.uid();
  v_edit_window_mode text;
  v_edit_window_hours int;
  v_day public.business_days;
  v_effective_date date;
  v_within_window boolean;
  v_requires_approval boolean;
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
  -- 0055 -- the same centralized logic SalesService.recordSale's own
  -- resolution chain is built on), not a raw current_date comparison,
  -- so a cross-midnight location's own rollover rules are respected
  -- exactly as they are everywhere else in this app.
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
    -- 'business_day' mode (default): still within window while the
    -- business day the sale was recorded in is open/reopened -- the
    -- exact same check SalesService.recordSale performs when deciding
    -- whether a new sale can even be recorded against that day. A sale
    -- with no business_day_id (shouldn't happen in practice) is treated
    -- as outside the window -- fail closed, not open.
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

  v_replacement_id := public._apply_sale_correction(
    v_sale, p_new_amount, p_new_quantity, p_new_notes, p_new_product_id, p_new_sale_date, p_reason,
    v_actor, v_actor, v_approval_id
  );

  return jsonb_build_object(
    'status', 'corrected', 'approvalRequestId', v_approval_id, 'replacementSaleId', v_replacement_id
  );
end;
$$;

-- resolve_approval_request -- full create-or-replace (never edit an
-- already-applied migration). Byte-for-byte identical to migration
-- 0074's version except the sale_correction branch also threads
-- new_sale_date through from the stored request payload.
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
      (v_request.request_payload ->> 'new_product_id')::uuid,
      (v_request.request_payload ->> 'new_sale_date')::date,
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

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke execute on function public.correct_sale(uuid, numeric, numeric, text, uuid, date, text) from public;
grant execute on function public.correct_sale(uuid, numeric, numeric, text, uuid, date, text) to authenticated;

revoke execute on function public._apply_sale_correction(public.sales, numeric, numeric, text, uuid, date, text, uuid, uuid, uuid) from public, authenticated;
