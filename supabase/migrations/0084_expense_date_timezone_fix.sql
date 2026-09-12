-- ============================================================================
-- 0084_expense_date_timezone_fix.sql
--
-- Bug found during Phase 1 live verification (not part of the original
-- Phase 1 scope, but a real, currently-live defect worth fixing while
-- here): migration 0054's `expense_date <= current_date` check
-- constraint compares against Postgres' own session date -- effectively
-- UTC on Supabase -- not the TENANT's timezone. Any tenant east of UTC
-- (confirmed live against Africa/Nairobi, UTC+3) has their local
-- calendar date roll over to "tomorrow" up to several hours before UTC
-- does, and recording a same-day expense during that window was
-- rejected outright: "new row ... violates check constraint
-- expenses_expense_date_check". correct_expense()'s own `p_new_expense_date
-- > current_date` guard (migration 0082, inherited unchanged from
-- edit_expense()) has the identical bug.
--
-- Fix: relax both to a generous `current_date + 1` UTC-day buffer --
-- enough slack to cover every real-world timezone (UTC-12 to UTC+14)
-- without ever falsely rejecting a tenant's genuine "today." The DB
-- layer's job here is only to catch clearly-wrong dates (weeks/months in
-- the future); the real, precise "not after the tenant's own today"
-- check already happens at the application layer, timezone-aware
-- (recordExpenseAction/correctExpenseAction both compare against
-- todayString(tenant.timezone), not a raw clock) -- this migration
-- doesn't touch that, only loosens the redundant DB-level backstop so it
-- stops producing false rejections.
-- ============================================================================

alter table public.expenses drop constraint expenses_expense_date_check;
alter table public.expenses add constraint expenses_expense_date_check check (expense_date <= current_date + 1);

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
  if p_new_expense_date is null or p_new_expense_date > current_date + 1 then
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
