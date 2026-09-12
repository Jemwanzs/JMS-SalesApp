-- ============================================================================
-- 0083_expense_receipts_storage.sql
--
-- Phase 1 of the Expense Management expansion: receipt attachments.
-- Unlike product-images (migration 0007/0041), this bucket is PRIVATE
-- from creation -- receipts are sensitive financial documents, not
-- something meant to be publicly servable by URL. That means, unlike
-- product-images, this bucket also needs a real SELECT policy (public
-- buckets serve reads with no RLS check at all; a private one doesn't).
--
-- Also adds the server-side receipt-requirement guard
-- (enforce_receipt_requirement) so the configured mode
-- (Settings -> Expense Receipt Requirement) is actually enforced, not
-- just suggested by the form.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy expense_receipts_storage_select on storage.objects
for select to authenticated
using (
  bucket_id = 'expense-receipts'
  and (
    public.has_permission(((storage.foldername(name))[1])::uuid, 'expenses.view_receipt')
    or public.has_permission(((storage.foldername(name))[1])::uuid, 'expenses.download_receipt')
  )
);

create policy expense_receipts_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'expenses.create')
);

create policy expense_receipts_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'expense-receipts'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'expenses.edit')
)
with check (
  bucket_id = 'expense-receipts'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'expenses.edit')
);

create policy expense_receipts_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'expense-receipts'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'expenses.edit')
);

-- Reads Settings -> Expense Receipt Requirement (tenant_settings keys
-- expense_receipt_requirement_mode 'never'|'always'|'amount_threshold'|
-- 'category', default 'never', and
-- expense_receipt_requirement_amount_threshold). Fires on INSERT always,
-- and on UPDATE only when a receipt-relevant field actually changed
-- (category/amount/the receipt itself) -- a plain status-only update
-- (void_expense's flip to 'voided') must never retroactively demand a
-- receipt on a row that was legitimately recorded before this setting
-- existed or changed.
create or replace function public.enforce_receipt_requirement()
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
begin
  if tg_op = 'UPDATE'
     and new.category_id is not distinct from old.category_id
     and new.actual_amount is not distinct from old.actual_amount
     and new.receipt_storage_path is not distinct from old.receipt_storage_path then
    return new;
  end if;

  select coalesce(value #>> '{}', 'never') into v_mode
  from public.tenant_settings
  where tenant_id = new.tenant_id and setting_key = 'expense_receipt_requirement_mode';
  v_mode := coalesce(v_mode, 'never');

  if v_mode = 'always' then
    v_requires := true;
  elsif v_mode = 'amount_threshold' then
    select coalesce((value)::text::numeric, 0) into v_threshold
    from public.tenant_settings
    where tenant_id = new.tenant_id and setting_key = 'expense_receipt_requirement_amount_threshold';
    v_requires := new.actual_amount >= coalesce(v_threshold, 0);
  elsif v_mode = 'category' and new.category_id is not null then
    select receipt_required into v_category_requires
    from public.expense_categories
    where id = new.category_id;
    v_requires := coalesce(v_category_requires, false);
  end if;

  if v_requires and new.receipt_storage_path is null then
    raise exception 'A receipt is required for this expense';
  end if;

  return new;
end;
$$;

create trigger expenses_enforce_receipt_requirement
  before insert or update on public.expenses
  for each row
  execute function public.enforce_receipt_requirement();
