-- ============================================================================
-- 0079_expense_categories_and_payment_methods.sql
--
-- Phase 1 of the Expense Management expansion (see the approved plan --
-- Daily Expenses today, migration 0054, is deliberately minimal: a flat
-- item catalog and a ledger with only amount/date/notes). This migration
-- adds the two foundational catalog tables everything else in Phase 1
-- builds on: expense_categories and expense_payment_methods, both
-- mirroring expense_items' own shape exactly (plain RLS-gated CRUD,
-- archived not hard-deleted so history stays intact).
-- ============================================================================

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  -- Feeds the "Based on Category" receipt-requirement mode (a later
  -- migration in this same phase) -- a plain per-category flag, not a
  -- separate rule table.
  receipt_required boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expense_categories_tenant on public.expense_categories (tenant_id, status);

alter table public.expense_categories enable row level security;

create policy expense_categories_select on public.expense_categories
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy expense_categories_insert on public.expense_categories
for insert to authenticated
with check (public.has_permission(tenant_id, 'expenses.manage_categories'));

create policy expense_categories_update on public.expense_categories
for update to authenticated
using (public.has_permission(tenant_id, 'expenses.manage_categories'))
with check (public.has_permission(tenant_id, 'expenses.manage_categories'));

-- No delete policy -- archived (status = 'archived'), never deleted, same
-- reasoning expense_items/products already document: expense rows below
-- reference this row via category_id and must keep a valid category to
-- join against even after it's retired.

create table public.expense_payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expense_payment_methods_tenant on public.expense_payment_methods (tenant_id, status);

-- "Exactly one default per tenant" as a real DB invariant, not just
-- application discipline -- ExpensePaymentMethodService.setDefault still
-- does an unset-then-set for a clean UX, but this index is the actual
-- backstop against a race producing two defaults.
create unique index idx_expense_payment_methods_one_default
  on public.expense_payment_methods (tenant_id)
  where (is_default and status = 'active');

alter table public.expense_payment_methods enable row level security;

create policy expense_payment_methods_select on public.expense_payment_methods
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy expense_payment_methods_insert on public.expense_payment_methods
for insert to authenticated
with check (public.has_permission(tenant_id, 'expenses.manage_payment_methods'));

create policy expense_payment_methods_update on public.expense_payment_methods
for update to authenticated
using (public.has_permission(tenant_id, 'expenses.manage_payment_methods'))
with check (public.has_permission(tenant_id, 'expenses.manage_payment_methods'));

-- No delete policy -- same reasoning as expense_categories above.

-- expense_items gains an optional category -- nullable so every existing
-- item (created before this migration) keeps working with no category
-- assigned; an admin assigns one later from the Items tab.
alter table public.expense_items add column category_id uuid references public.expense_categories (id);
create index idx_expense_items_category on public.expense_items (tenant_id, category_id);

insert into public.permissions (key, module, description, is_read_only) values
  ('expenses.manage_categories', 'expenses', 'Create, edit, and archive expense categories', false),
  ('expenses.manage_payment_methods', 'expenses', 'Create, edit, and archive expense payment methods', false);

-- Tenant-Administrator-only by default, same as every other expenses.*
-- permission (docs/06-roles-permissions.md's "keep Sales/Expenses simple"
-- convention) -- a tenant admin can still grant either to a custom or
-- Supervisor role afterward via the Roles page, no code change needed.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key in ('expenses.manage_categories', 'expenses.manage_payment_methods')
on conflict do nothing;
