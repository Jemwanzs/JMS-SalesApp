-- ============================================================================
-- 0080_expenses_ledger_enrichment.sql
--
-- Phase 1 of the Expense Management expansion, part 2: the new ledger
-- columns (category/payment-method/vendor/reference/tax/reimbursable/
-- receipt) and the first true cross-branch visibility permission in the
-- app (expenses.view_all). Receipts themselves (Storage bucket, upload
-- enforcement) land in a later migration in this same phase -- this one
-- only adds the columns they'll write to, so expenses doesn't need a
-- second migration touching this table later.
--
-- IMPORTANT architectural note (see the approved plan's own "second
-- discovery"): unlike sales.view_all (which stays AND'ed with
-- location_id = current_active_location(), meaning "everyone's sales at
-- MY branch," not company-wide), expenses.view_all here OR-bypasses the
-- branch restriction entirely -- the first genuine cross-branch view in
-- this app. Deliberately isolated to expenses, Tenant-Administrator-only
-- by default.
-- ============================================================================

alter table public.expenses
  add column category_id uuid references public.expense_categories (id),
  add column category_name_snapshot text,
  add column payment_method_id uuid references public.expense_payment_methods (id),
  add column payment_method_name_snapshot text,
  add column vendor text,
  add column reference_number text,
  add column tax_amount numeric(12, 2) check (tax_amount is null or tax_amount >= 0),
  add column reimbursable boolean not null default false,
  add column receipt_storage_path text,
  add column receipt_file_type text,
  -- OCR extension seam -- Phase 1 code never writes this column. A later
  -- phase can populate it from a real OCR provider without another
  -- migration touching this table.
  add column receipt_extracted_data jsonb;

create index idx_expenses_vendor on public.expenses (tenant_id, vendor);
create index idx_expenses_category on public.expenses (tenant_id, category_id);
create index idx_expenses_payment_method on public.expenses (tenant_id, payment_method_id);

insert into public.permissions (key, module, description, is_read_only) values
  ('expenses.view_all', 'expenses', 'View expenses recorded at every branch, not just the currently active one', true),
  ('expenses.view_receipt', 'expenses', 'Preview a receipt attached to a recorded expense', true),
  ('expenses.download_receipt', 'expenses', 'Download a receipt attached to a recorded expense', true),
  ('expenses.export', 'expenses', 'Export expense records as CSV/PDF', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key in ('expenses.view_all', 'expenses.view_receipt', 'expenses.download_receipt', 'expenses.export')
on conflict do nothing;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
for select to authenticated
using (
  public.has_permission(tenant_id, 'expenses.view')
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or public.has_permission(tenant_id, 'expenses.view_all')
    or location_id = public.current_active_location(tenant_id)
  )
);

-- expenses_insert is untouched -- recording stays branch-scoped even for
-- a view_all holder; view_all only ever widens what can be READ.
