-- ============================================================================
-- 0074_sale_delete_and_edit_windows.sql
--
-- APP ENHANCEMENTS — SALES RECORD CORRECTION & DELETION.
--
-- Requires migration 0073 (adds 'deleted' to sale_status) to already be
-- COMMITTED -- this file's trigger redefinition near the bottom uses
-- 'deleted' in a WHEN clause, which Postgres refuses if the enum value
-- was added in the very same transaction ("unsafe use of new value ...
-- must be committed before they can be used"). That's why the enum
-- addition is its own separate, already-applied migration rather than
-- the first statement of this one.
--
-- Three things land in this migration:
--
-- 1. Correct Sale can now also change the PRODUCT, not just amount/
--    quantity/notes. `_apply_sale_correction` re-looks-up the new
--    product's own name/image/price for the replacement row's snapshot
--    columns -- it used to blindly copy the OLD row's snapshots, which
--    would have silently kept the old product's name/image on a
--    product-changed correction. No stock-trigger change is needed for
--    this: the old replacement-row pattern already restores the old
--    row's stock (keyed off its own id/product) and deducts the new
--    row's stock (keyed off its own id/product) independently -- see
--    migration 0067's triggers, unchanged here.
--
-- 2. A new, genuinely separate DELETE action (`delete_sale`), distinct
--    from VOID: no mandatory reason, a short self-service time window
--    (tenant-configurable, default 2 minutes), and -- unlike voided/
--    corrected sales, which stay visible in Sales History for audit --
--    a deleted sale disappears from it entirely (SalesService.listRecent
--    gets its first-ever status filter).
--
-- 3. The existing `sales.edit_window` permission is repurposed in place
--    as the tenant's single "Edit / Correct Sales" toggle (its
--    description is updated for clarity) rather than adding a redundant
--    new permission key -- confirmed via a full-repo grep that nothing
--    hardcodes assumptions about its exact wording anywhere user-facing.
--    `sales.correct_historical` is untouched -- it's already the
--    "privileged admin correction process" the spec itself says should
--    still exist once the edit window closes. One genuinely new
--    permission is added: `sales.delete`. Both `sales.edit_window` and
--    `sales.delete` are backfilled onto the "Sales User"/"Supervisor"/
--    "Tenant Administrator" system-default roles (existing tenants) and
--    services/RoleService.ts's DEFAULT_ROLE_GRANTS (future tenants) --
--    per the spec's explicit "if Create Sales is ON, default this ON
--    too" requirement. This is a deliberate departure from this
--    codebase's own past convention (sales.reverse, migration 0026, was
--    NOT auto-granted to Supervisor) -- noted here so it doesn't read as
--    an inconsistency later.
--
-- The edit window itself gains two tenant-configurable modes (setting
-- keys `sale_edit_window_mode` 'business_day'|'hours', default
-- 'business_day', and `sale_edit_window_hours` used only in 'hours'
-- mode) -- replacing the old fixed-minutes-only `sale_edit_window_minutes`
-- key, which is left alone/unread going forward (no data migration; this
-- app is pre-production). Business-day mode reuses the exact same
-- open/reopened check SalesService.recordSale already performs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- sale_corrections.correction_type gains 'delete'. Constraint name isn't
-- hardcoded anywhere in this repo (migration 0006 never named it), so it's
-- looked up dynamically, same pattern 0026 used to add 'reverse'.
-- ----------------------------------------------------------------------------
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
  check (correction_type in ('void', 'correct', 'reverse', 'delete'));

-- ----------------------------------------------------------------------------
-- Permissions catalog
-- ----------------------------------------------------------------------------
insert into public.permissions (key, module, description, is_read_only) values
  ('sales.delete', 'sales', 'Delete (soft-remove) an own sale within the configured deletion window', false);

update public.permissions
set description = 'Edit / correct sales -- within the tenant''s configured edit window (own sales only)'
where key = 'sales.edit_window';

-- Backfill existing tenants' system-default roles -- future tenants get
-- this via services/RoleService.ts's DEFAULT_ROLE_GRANTS (updated
-- alongside this migration).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name in ('Sales User', 'Supervisor', 'Tenant Administrator')
  and p.key in ('sales.edit_window', 'sales.delete')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- correct_sale gains a product parameter; its old 5-arg signature is
-- dropped explicitly first -- CREATE OR REPLACE would otherwise leave the
-- old overload callable alongside the new one (Postgres treats a
-- different parameter list as a distinct function), which is exactly the
-- kind of ambiguity PostgREST's RPC dispatch can't safely resolve.
-- ----------------------------------------------------------------------------
drop function if exists public.correct_sale(uuid, numeric, numeric, text, text);

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

create or replace function public.correct_sale(
  p_sale_id uuid,
  p_new_amount numeric,
  p_new_quantity numeric,
  p_new_notes text,
  p_new_product_id uuid,
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

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'open' then
    raise exception 'Sale is "%", not open -- it has already been voided, corrected, deleted, or reversed', v_sale.status;
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
      'new_notes', p_new_notes, 'new_product_id', p_new_product_id, 'reason', p_reason
    ),
    case when v_requires_approval then 'pending' else 'auto_approved' end
  )
  returning id into v_approval_id;

  if v_requires_approval then
    return jsonb_build_object('status', 'pending_approval', 'approvalRequestId', v_approval_id);
  end if;

  v_replacement_id := public._apply_sale_correction(
    v_sale, p_new_amount, p_new_quantity, p_new_notes, p_new_product_id, p_reason, v_actor, v_actor, v_approval_id
  );

  return jsonb_build_object(
    'status', 'corrected', 'approvalRequestId', v_approval_id, 'replacementSaleId', v_replacement_id
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- delete_sale -- deliberately simpler than void/correct/reverse: no
-- mandatory reason, no approval-deferral (an instant "undo my own
-- mistake"), self-service only (recorded_by = actor -- Void already
-- covers "an admin removes someone else's sale", any timeframe).
-- ----------------------------------------------------------------------------
create or replace function public._apply_sale_delete(
  p_sale public.sales,
  p_reason text,
  p_requested_by uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.sales set status = 'deleted' where id = p_sale.id;

  -- sale_corrections.reason is NOT NULL (migration 0006) -- delete has no
  -- mandatory reason, so a blank one is coalesced to a literal here
  -- rather than loosening a constraint every other mutation path relies on.
  insert into public.sale_corrections (
    tenant_id, sale_id, correction_type, old_values, reason, requested_by, approved_by
  ) values (
    p_sale.tenant_id, p_sale.id, 'delete', to_jsonb(p_sale),
    coalesce(nullif(trim(p_reason), ''), 'Deleted by user'), p_requested_by, p_requested_by
  );
end;
$$;

create or replace function public.delete_sale(p_sale_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sale public.sales;
  v_actor uuid := auth.uid();
  v_enabled boolean;
  v_window_minutes int;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Sale not found';
  end if;

  if v_sale.status <> 'open' then
    raise exception 'Sale is "%", not open -- it has already been voided, corrected, deleted, or reversed', v_sale.status;
  end if;

  if v_actor <> v_sale.recorded_by then
    raise exception 'Only the person who recorded this sale can delete it';
  end if;

  if not public.has_permission(v_sale.tenant_id, 'sales.delete') then
    raise exception 'Not authorized to delete sales';
  end if;

  select coalesce((value)::text::boolean, true) into v_enabled
  from public.tenant_settings
  where tenant_id = v_sale.tenant_id and setting_key = 'sale_deletion_enabled';
  v_enabled := coalesce(v_enabled, true);

  select coalesce((value)::text::int, 2) into v_window_minutes
  from public.tenant_settings
  where tenant_id = v_sale.tenant_id and setting_key = 'sale_delete_window_minutes';
  v_window_minutes := coalesce(v_window_minutes, 2);

  if not v_enabled or v_window_minutes <= 0
    or now() >= v_sale.created_at + (v_window_minutes || ' minutes')::interval then
    raise exception 'Sale deletion window has closed';
  end if;

  perform public._apply_sale_delete(v_sale, p_reason, v_actor);

  return jsonb_build_object('status', 'deleted');
end;
$$;

-- ----------------------------------------------------------------------------
-- resolve_approval_request -- full create-or-replace (never edit an
-- already-applied migration). Byte-for-byte identical to migration
-- 0026's version except the sale_correction branch also threads
-- new_product_id through from the stored request payload. Delete has no
-- approval flow, so no new branch is added here.
-- ----------------------------------------------------------------------------
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
-- Stock reversal trigger (migration 0067) gains 'deleted' in its WHEN
-- clause -- the ONLY change needed for delete's stock-reversal behavior;
-- the function body already generically restores whatever was deducted,
-- keyed off reference_id, regardless of which status the row transitions
-- to. Trigger name/timing/function are otherwise unchanged. Safe here
-- (unlike if it were bundled with 0073) because 'deleted' was added in
-- that earlier, already-committed migration.
-- ----------------------------------------------------------------------------
drop trigger if exists stock_restore_on_sale_status_change on public.sales;

create trigger stock_restore_on_sale_status_change
after update of status on public.sales
for each row
when (old.status = 'open' and new.status in ('voided', 'corrected', 'reversed', 'deleted'))
execute function public._stock_restore_on_sale_status_change();

-- ----------------------------------------------------------------------------
-- Grants
-- ----------------------------------------------------------------------------
revoke execute on function public.correct_sale(uuid, numeric, numeric, text, uuid, text) from public;
grant execute on function public.correct_sale(uuid, numeric, numeric, text, uuid, text) to authenticated;

revoke execute on function public.delete_sale(uuid, text) from public;
grant execute on function public.delete_sale(uuid, text) to authenticated;

revoke execute on function public._apply_sale_correction(public.sales, numeric, numeric, text, uuid, text, uuid, uuid, uuid) from public, authenticated;
revoke execute on function public._apply_sale_delete(public.sales, text, uuid) from public, authenticated;
