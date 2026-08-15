-- ============================================================================
-- 0006_approval_engine_and_sale_corrections.sql
--
-- Phase 2g (Approval Engine v1) + Phase 2e (sale edit-window / historical
-- correction / void). See:
--   docs/08-sales-engine.md            -- sale editing rules, VOID/CORRECT/REVERSE
--   docs/19-security-checklist.md §5   -- generic approval engine design
--
-- Design: one generic `approval_requests` table, dispatched by `type`. A
-- request is ALWAYS created -- even when a tenant doesn't require human
-- review, in which case it's written pre-resolved as 'auto_approved' -- so
-- the audit trail and dispatch path are identical either way (no branching
-- between "logged" and "not logged" cases downstream).
--
-- `sales` still gets NO direct UPDATE/DELETE RLS policy (that invariant
-- from migration 0005 doesn't change). All mutation happens through two
-- SECURITY DEFINER functions (void_sale, correct_sale) that enforce
-- permission + edit-window + approval-routing in one place, the same
-- pattern already used for assign_sale_number/has_permission. A client can
-- never bypass this by crafting its own UPDATE, because no policy grants
-- that command at all -- only these functions (running as table owner) can
-- write to `sales.status` post-insert.
--
-- REVERSE (reversing entries) is deliberately NOT implemented here --
-- VOID and CORRECT cover the two real-world cases this phase targets;
-- REVERSE is a documented future increment, not silently dropped.
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('approvals.manage', 'approvals', 'Review and decide pending approval requests', false);

-- ============================================================================
-- 1. APPROVAL_REQUESTS (generic engine)
-- ============================================================================

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  type text not null,
  requested_by uuid not null references public.profiles (id),
  request_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'auto_approved')),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_notes text,
  resolution_payload jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_approval_requests_tenant on public.approval_requests (tenant_id);
create index idx_approval_requests_tenant_status on public.approval_requests (tenant_id, status);

create trigger set_approval_requests_updated_at
before update on public.approval_requests
for each row execute function public.set_updated_at();

alter table public.approval_requests enable row level security;

create policy approval_requests_select on public.approval_requests
for select to authenticated
using (
  requested_by = auth.uid()
  or public.has_permission(tenant_id, 'approvals.manage')
);

-- Insert/update happen exclusively through the SECURITY DEFINER functions
-- below (running as table owner) -- no direct-write policy is granted, so
-- a client can request an action but can never self-approve by crafting
-- its own insert/update against this table.

-- ============================================================================
-- 2. SALE_CORRECTIONS (immutable ledger -- same pattern as audit_logs)
-- ============================================================================

create table public.sale_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sale_id uuid not null references public.sales (id),
  correction_type text not null check (correction_type in ('void', 'correct')),
  old_values jsonb not null,
  new_values jsonb,
  reason text not null,
  requested_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approval_request_id uuid references public.approval_requests (id),
  replacement_sale_id uuid references public.sales (id),
  created_at timestamptz not null default now()
);

create index idx_sale_corrections_tenant on public.sale_corrections (tenant_id);
create index idx_sale_corrections_sale on public.sale_corrections (sale_id);

alter table public.sale_corrections enable row level security;

create policy sale_corrections_select on public.sale_corrections
for select to authenticated
using (
  public.has_permission(tenant_id, 'sales.view_all')
  or (public.has_permission(tenant_id, 'sales.view_own') and requested_by = auth.uid())
);

-- No insert/update/delete policy: written exclusively by the SECURITY
-- DEFINER functions below, at the moment a correction is actually applied
-- (not at request time) -- see the functions' comments.

-- ============================================================================
-- 3. INTERNAL APPLY HELPERS (not directly callable by authenticated -- see
--    grants at the bottom)
-- ============================================================================

create or replace function public._apply_sale_void(
  p_sale public.sales,
  p_reason text,
  p_requested_by uuid,
  p_approved_by uuid,
  p_approval_request_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sales set status = 'voided' where id = p_sale.id;

  insert into public.sale_corrections (
    tenant_id, sale_id, correction_type, old_values, reason,
    requested_by, approved_by, approval_request_id
  ) values (
    p_sale.tenant_id, p_sale.id, 'void', to_jsonb(p_sale), p_reason,
    p_requested_by, p_approved_by, p_approval_request_id
  );
end;
$$;

create or replace function public._apply_sale_correction(
  p_sale public.sales,
  p_new_amount numeric,
  p_new_quantity numeric,
  p_new_notes text,
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
begin
  update public.sales set status = 'corrected' where id = p_sale.id;

  insert into public.sales (
    tenant_id, location_id, business_day_id, product_id,
    product_name_snapshot, product_image_snapshot, expected_price_snapshot,
    actual_amount, quantity, notes, recorded_by, sale_date, idempotency_key
  ) values (
    p_sale.tenant_id, p_sale.location_id, p_sale.business_day_id, p_sale.product_id,
    p_sale.product_name_snapshot, p_sale.product_image_snapshot, p_sale.expected_price_snapshot,
    p_new_amount, p_new_quantity, p_new_notes, p_sale.recorded_by, p_sale.sale_date, gen_random_uuid()
  )
  returning id into v_replacement_id;

  insert into public.sale_corrections (
    tenant_id, sale_id, correction_type, old_values, new_values, reason,
    requested_by, approved_by, approval_request_id, replacement_sale_id
  ) values (
    p_sale.tenant_id, p_sale.id, 'correct', to_jsonb(p_sale),
    jsonb_build_object('actual_amount', p_new_amount, 'quantity', p_new_quantity, 'notes', p_new_notes),
    p_reason, p_requested_by, p_approved_by, p_approval_request_id, v_replacement_id
  );

  return v_replacement_id;
end;
$$;

-- ============================================================================
-- 4. PUBLIC ENTRYPOINTS
-- ============================================================================

create or replace function public.void_sale(p_sale_id uuid, p_reason text)
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
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to void a sale';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'open' then
    raise exception 'Sale is "%", not open -- it has already been voided or corrected', v_sale.status;
  end if;

  if not public.has_permission(v_sale.tenant_id, 'sales.void') then
    raise exception 'Not authorized to void sales';
  end if;

  select coalesce((value)::text::boolean, false) into v_requires_approval
  from public.tenant_settings
  where tenant_id = v_sale.tenant_id and setting_key = 'sale_void_requires_approval';
  v_requires_approval := coalesce(v_requires_approval, false);

  insert into public.approval_requests (tenant_id, type, requested_by, request_payload, status)
  values (
    v_sale.tenant_id, 'sale_void', v_actor,
    jsonb_build_object('sale_id', p_sale_id, 'reason', p_reason),
    case when v_requires_approval then 'pending' else 'auto_approved' end
  )
  returning id into v_approval_id;

  if v_requires_approval then
    return jsonb_build_object('status', 'pending_approval', 'approvalRequestId', v_approval_id);
  end if;

  perform public._apply_sale_void(v_sale, p_reason, v_actor, v_actor, v_approval_id);

  return jsonb_build_object('status', 'voided', 'approvalRequestId', v_approval_id);
end;
$$;

create or replace function public.correct_sale(
  p_sale_id uuid,
  p_new_amount numeric,
  p_new_quantity numeric,
  p_new_notes text,
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
  v_edit_window_minutes int;
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

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'open' then
    raise exception 'Sale is "%", not open -- it has already been voided or corrected', v_sale.status;
  end if;

  select coalesce((value)::text::int, 15) into v_edit_window_minutes
  from public.tenant_settings
  where tenant_id = v_sale.tenant_id and setting_key = 'sale_edit_window_minutes';
  v_edit_window_minutes := coalesce(v_edit_window_minutes, 15);

  v_within_window := v_actor = v_sale.recorded_by
    and now() < v_sale.created_at + (v_edit_window_minutes || ' minutes')::interval;

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
      'sale_id', p_sale_id, 'new_amount', p_new_amount,
      'new_quantity', p_new_quantity, 'new_notes', p_new_notes, 'reason', p_reason
    ),
    case when v_requires_approval then 'pending' else 'auto_approved' end
  )
  returning id into v_approval_id;

  if v_requires_approval then
    return jsonb_build_object('status', 'pending_approval', 'approvalRequestId', v_approval_id);
  end if;

  v_replacement_id := public._apply_sale_correction(
    v_sale, p_new_amount, p_new_quantity, p_new_notes, p_reason, v_actor, v_actor, v_approval_id
  );

  return jsonb_build_object(
    'status', 'corrected', 'approvalRequestId', v_approval_id, 'replacementSaleId', v_replacement_id
  );
end;
$$;

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
  else
    raise exception 'Unknown approval request type: %', v_request.type;
  end if;
end;
$$;

revoke execute on function public.void_sale(uuid, text) from public;
grant execute on function public.void_sale(uuid, text) to authenticated;

revoke execute on function public.correct_sale(uuid, numeric, numeric, text, text) from public;
grant execute on function public.correct_sale(uuid, numeric, numeric, text, text) to authenticated;

revoke execute on function public.resolve_approval_request(uuid, text, text) from public;
grant execute on function public.resolve_approval_request(uuid, text, text) to authenticated;

-- _apply_sale_void / _apply_sale_correction are intentionally never granted
-- to authenticated -- only callable from within the SECURITY DEFINER
-- functions above (object-owner privilege), never directly by a client.
revoke execute on function public._apply_sale_void(public.sales, text, uuid, uuid, uuid) from public, authenticated;
revoke execute on function public._apply_sale_correction(public.sales, numeric, numeric, text, text, uuid, uuid, uuid) from public, authenticated;
