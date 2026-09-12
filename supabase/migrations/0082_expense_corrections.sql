-- ============================================================================
-- 0082_expense_corrections.sql
--
-- Phase 1 of the Expense Management expansion: a real correction flow.
-- Today's edit_expense() (migration 0054) requires no reason and keeps
-- no before/after record beyond edited_by/edited_at timestamps. This
-- migration replaces it with correct_expense() -- covers every
-- correctable field (date/item/category/amount/vendor/payment-method/
-- reference/tax/reimbursable/notes/receipt), requires a reason, and
-- writes a structured expense_corrections row (old_values/new_values),
-- mirroring sale_corrections' own shape (0006_approval_engine_and_
-- sale_corrections.sql) minus the approval-workflow/replacement-row
-- machinery -- Phase 1 correction stays direct/permission-gated and
-- IN PLACE (same id, no replacement row), preserving 0054's own stated
-- "deliberately simpler than sales" philosophy. void_expense() is
-- extended (signature unchanged) to write the same table too, so both
-- void and correct share one queryable correction ledger.
-- ============================================================================

create table public.expense_corrections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  expense_id uuid not null references public.expenses (id),
  correction_type text not null check (correction_type in ('void', 'correct')),
  old_values jsonb not null,
  new_values jsonb,
  reason text not null,
  corrected_by uuid not null references public.profiles (id),
  corrected_at timestamptz not null default now()
);

create index idx_expense_corrections_tenant on public.expense_corrections (tenant_id);
create index idx_expense_corrections_expense on public.expense_corrections (expense_id);

alter table public.expense_corrections enable row level security;

-- No insert/update/delete policy -- written only inside correct_expense()/
-- void_expense() below, same "immutable ledger, RPC-only writes" pattern
-- sale_corrections/audit_logs already establish.
create policy expense_corrections_select on public.expense_corrections
for select to authenticated
using (
  public.has_permission(tenant_id, 'expenses.view')
  and exists (
    select 1 from public.expenses e
    where e.id = expense_corrections.expense_id
      and (
        public.impersonated_profile_id(expense_corrections.tenant_id) is not null
        or public.has_permission(expense_corrections.tenant_id, 'expenses.view_all')
        or e.location_id = public.current_active_location(expense_corrections.tenant_id)
      )
  )
);

drop function if exists public.edit_expense(uuid, numeric, date, text);

create or replace function public.correct_expense(
  p_expense_id uuid,
  p_reason text,
  p_new_expense_date date,
  p_new_expense_item_id uuid,
  p_new_category_id uuid,
  p_new_actual_amount numeric,
  p_new_vendor text,
  p_new_payment_method_id uuid,
  p_new_reference_number text,
  p_new_tax_amount numeric,
  p_new_reimbursable boolean,
  p_new_notes text,
  p_new_receipt_storage_path text,
  p_new_receipt_file_type text
)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense public.expenses;
  v_old_values jsonb;
  v_item_name text;
  v_category_name text;
  v_payment_method_name text;
  v_actor uuid := auth.uid();
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to correct an expense';
  end if;
  if p_new_actual_amount is null or p_new_actual_amount <= 0 then
    raise exception 'Enter an amount greater than 0';
  end if;
  if p_new_expense_date is null or p_new_expense_date > current_date then
    raise exception 'The expense date cannot be in the future';
  end if;

  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'Expense not found';
  end if;
  if v_expense.status <> 'active' then
    raise exception 'Expense is "%", not active -- it has already been voided', v_expense.status;
  end if;
  if not public.has_permission(v_expense.tenant_id, 'expenses.edit') then
    raise exception 'Not authorized to correct expenses';
  end if;

  -- Captured BEFORE the update below -- this is the actual "old" row,
  -- unlike naively re-deriving it from the post-update result.
  v_old_values := to_jsonb(v_expense);

  select name into v_item_name from public.expense_items
  where id = p_new_expense_item_id and tenant_id = v_expense.tenant_id;
  if not found then
    raise exception 'Expense item not found';
  end if;

  select name into v_category_name from public.expense_categories
  where id = p_new_category_id and tenant_id = v_expense.tenant_id;
  if not found then
    raise exception 'Expense category not found';
  end if;

  select name into v_payment_method_name from public.expense_payment_methods
  where id = p_new_payment_method_id and tenant_id = v_expense.tenant_id;
  if not found then
    raise exception 'Payment method not found';
  end if;

  update public.expenses
  set expense_date = p_new_expense_date,
      expense_item_id = p_new_expense_item_id,
      expense_item_name_snapshot = v_item_name,
      category_id = p_new_category_id,
      category_name_snapshot = v_category_name,
      actual_amount = p_new_actual_amount,
      vendor = p_new_vendor,
      payment_method_id = p_new_payment_method_id,
      payment_method_name_snapshot = v_payment_method_name,
      reference_number = p_new_reference_number,
      tax_amount = p_new_tax_amount,
      reimbursable = coalesce(p_new_reimbursable, false),
      notes = p_new_notes,
      receipt_storage_path = p_new_receipt_storage_path,
      receipt_file_type = p_new_receipt_file_type,
      edited_by = v_actor,
      edited_at = now()
  where id = p_expense_id
  returning * into v_expense;

  insert into public.expense_corrections (tenant_id, expense_id, correction_type, old_values, new_values, reason, corrected_by)
  values (
    v_expense.tenant_id,
    v_expense.id,
    'correct',
    v_old_values,
    jsonb_build_object(
      'expense_date', p_new_expense_date,
      'expense_item_id', p_new_expense_item_id,
      'expense_item_name_snapshot', v_item_name,
      'category_id', p_new_category_id,
      'category_name_snapshot', v_category_name,
      'actual_amount', p_new_actual_amount,
      'vendor', p_new_vendor,
      'payment_method_id', p_new_payment_method_id,
      'payment_method_name_snapshot', v_payment_method_name,
      'reference_number', p_new_reference_number,
      'tax_amount', p_new_tax_amount,
      'reimbursable', coalesce(p_new_reimbursable, false),
      'notes', p_new_notes,
      'receipt_storage_path', p_new_receipt_storage_path,
      'receipt_file_type', p_new_receipt_file_type
    ),
    p_reason,
    v_actor
  );

  return v_expense;
end;
$$;

revoke execute on function public.correct_expense(uuid, text, date, uuid, uuid, numeric, text, uuid, text, numeric, boolean, text, text, text) from public;
grant execute on function public.correct_expense(uuid, text, date, uuid, uuid, numeric, text, uuid, text, numeric, boolean, text, text, text) to authenticated;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense public.expenses;
  v_old_values jsonb;
  v_actor uuid := auth.uid();
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to void an expense';
  end if;

  select * into v_expense from public.expenses where id = p_expense_id for update;
  if not found then
    raise exception 'Expense not found';
  end if;
  if v_expense.status <> 'active' then
    raise exception 'Expense is "%", not active -- it has already been voided', v_expense.status;
  end if;
  if not public.has_permission(v_expense.tenant_id, 'expenses.void') then
    raise exception 'Not authorized to void expenses';
  end if;

  v_old_values := to_jsonb(v_expense);

  update public.expenses
  set status = 'voided',
      voided_by = v_actor,
      voided_at = now(),
      void_reason = p_reason
  where id = p_expense_id
  returning * into v_expense;

  insert into public.expense_corrections (tenant_id, expense_id, correction_type, old_values, new_values, reason, corrected_by)
  values (v_expense.tenant_id, v_expense.id, 'void', v_old_values, jsonb_build_object('status', 'voided'), p_reason, v_actor);

  return v_expense;
end;
$$;

revoke execute on function public.void_expense(uuid, text) from public;
grant execute on function public.void_expense(uuid, text) to authenticated;
