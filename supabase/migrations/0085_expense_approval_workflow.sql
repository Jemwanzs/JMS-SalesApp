-- ============================================================================
-- 0085_expense_approval_workflow.sql
--
-- Expense Management Phase 2a: approval workflow. Deferred out of Phase 1
-- on purpose (see memory/the approved Phase 1 plan's own "explicitly
-- deferred" list) -- this is the first follow-up phase.
--
-- Reuses the SAME generic approval engine sales already dispatches
-- through (approval_requests, migration 0006) rather than inventing a
-- parallel mechanism -- a new `expense_create` request `type`, and a new
-- dispatch branch in resolve_approval_request(). That also means
-- reviewing an expense approval needs no new permission: it's gated on
-- the same `approvals.manage` every other request type already uses
-- (sale void/correction, business day reopen, temporary access) --
-- introducing a separate `expenses.approve` would only add a permission
-- resolve_approval_request() itself would never actually check (it
-- authorizes by `approvals.manage` alone, regardless of `type`).
--
-- Gating happens in a new BEFORE INSERT trigger (gate_expense_approval),
-- the same shape as enforce_receipt_requirement() (migration 0083): reads
-- a tenant_settings mode (never/always/amount_threshold/category) and,
-- when a newly-recorded expense requires review, flips its own status to
-- 'pending_approval' and creates the approval_requests row in the same
-- statement -- an expense is never inserted as 'active' and then
-- separately demoted. expense_categories gains its own
-- `requires_approval` flag for the "category" mode, mirroring
-- `receipt_required` exactly.
--
-- Scope note: correcting/voiding an expense still requires it to be
-- 'active' (correct_expense/void_expense, unchanged) -- a pending or
-- rejected expense can't be edited or resubmitted in this phase. That's a
-- deliberate, documented gap (like migration 0006's own "REVERSE is a
-- documented future increment"), not silently dropped: resubmission is a
-- follow-up increment, not required for a working approval gate.
-- ============================================================================

alter table public.expense_categories
  add column requires_approval boolean not null default false;

alter table public.expenses
  add column approval_request_id uuid references public.approval_requests (id),
  add column rejection_reason text;

alter table public.expenses drop constraint expenses_status_check;
alter table public.expenses add constraint expenses_status_check
  check (status in ('active', 'voided', 'pending_approval', 'rejected'));

create or replace function public.gate_expense_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode text;
  v_threshold numeric;
  v_category_requires boolean;
  v_requires boolean := false;
  v_request_id uuid;
begin
  select coalesce(value #>> '{}', 'never') into v_mode
  from public.tenant_settings
  where tenant_id = new.tenant_id and setting_key = 'expense_approval_mode';
  v_mode := coalesce(v_mode, 'never');

  if v_mode = 'always' then
    v_requires := true;
  elsif v_mode = 'amount_threshold' then
    select coalesce((value)::text::numeric, 0) into v_threshold
    from public.tenant_settings
    where tenant_id = new.tenant_id and setting_key = 'expense_approval_amount_threshold';
    v_requires := new.actual_amount >= coalesce(v_threshold, 0);
  elsif v_mode = 'category' and new.category_id is not null then
    select requires_approval into v_category_requires
    from public.expense_categories
    where id = new.category_id;
    v_requires := coalesce(v_category_requires, false);
  end if;

  if not v_requires then
    return new;
  end if;

  insert into public.approval_requests (tenant_id, type, requested_by, request_payload, status)
  values (
    new.tenant_id,
    'expense_create',
    new.recorded_by,
    jsonb_build_object('expense_id', new.id, 'amount', new.actual_amount, 'category_id', new.category_id),
    'pending'
  )
  returning id into v_request_id;

  new.status := 'pending_approval';
  new.approval_request_id := v_request_id;
  return new;
end;
$$;

create trigger expenses_gate_approval
  before insert on public.expenses
  for each row
  execute function public.gate_expense_approval();

-- resolve_approval_request -- full create-or-replace (never edit an
-- already-applied migration). Every branch through 'sale_reversal' is
-- byte-for-byte identical to migration 0078's version; only the rejected-
-- decision handling (now type-aware, since rejecting an expense_create
-- request needs to flip the pending expense's own status -- unlike
-- rejecting a sale void/correction, which leaves the untouched original
-- sale exactly as it was) and the new 'expense_create' approved branch
-- are new.
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
  v_expense public.expenses;
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
    if v_request.type = 'expense_create' then
      update public.expenses
      set status = 'rejected', rejection_reason = p_notes
      where id = (v_request.request_payload ->> 'expense_id')::uuid and status = 'pending_approval';
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
  elsif v_request.type = 'expense_create' then
    select * into v_expense from public.expenses where id = (v_request.request_payload ->> 'expense_id')::uuid for update;
    if not found or v_expense.status <> 'pending_approval' then
      raise exception 'Expense is no longer pending approval';
    end if;
    update public.expenses set status = 'active' where id = v_expense.id;
    return jsonb_build_object('status', 'approved', 'type', v_request.type, 'expenseId', v_expense.id);
  else
    raise exception 'Unknown approval request type: %', v_request.type;
  end if;
end;
$$;
