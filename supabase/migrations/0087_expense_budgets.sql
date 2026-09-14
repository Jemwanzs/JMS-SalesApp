-- ============================================================================
-- 0087_expense_budgets.sql
--
-- Expense Management Phase 2c: budgets & threshold alerts. A monthly
-- spend cap per (branch, category) -- deliberately branch-scoped, not
-- tenant-wide, since expenses themselves are branch-scoped by default
-- (only expenses.view_all bypasses that, and a single cross-branch
-- budget number wouldn't map cleanly onto per-branch actuals anyway).
--
-- Config table only -- no approval_requests/trigger-gating mechanism
-- needed here (unlike Phase 2a/2b): a budget is advisory, never blocks
-- recording an over-budget expense. The dashboard/record-form UI reads
-- this table plus the existing expenses ledger to compute status
-- entirely in application code (same "fetch raw rows, aggregate in JS"
-- convention ExpenseService.getBreakdown/getDashboardSummary already
-- use) -- no new SECURITY DEFINER function needed for reads.
--
-- RLS mirrors expense_categories/expense_payment_methods exactly:
-- visible tenant-wide to anyone with expenses.view (config data, not a
-- transactional record -- same reasoning those two tables already use),
-- insert/update gated on a new expenses.manage_budgets permission, no
-- delete policy (archive only).
-- ============================================================================

insert into public.permissions (key, module, description, is_read_only) values
  ('expenses.manage_budgets', 'expenses', 'Configure monthly expense budgets per category and branch', false);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key = 'expenses.manage_budgets'
on conflict do nothing;

create table public.expense_budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  category_id uuid not null references public.expense_categories (id),
  monthly_amount numeric(12, 2) not null check (monthly_amount >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active budget per branch+category combo -- the real race backstop
-- for the "archive the old one, create a new one" update flow the UI
-- uses, same partial-unique-index pattern as expense_payment_methods'
-- "one default" constraint (migration 0079).
create unique index idx_expense_budgets_one_active on public.expense_budgets (tenant_id, location_id, category_id) where status = 'active';
create index idx_expense_budgets_tenant_location on public.expense_budgets (tenant_id, location_id);

create trigger set_expense_budgets_updated_at
before update on public.expense_budgets
for each row execute function public.set_updated_at();

alter table public.expense_budgets enable row level security;

create policy expense_budgets_select on public.expense_budgets
for select to authenticated
using (public.has_permission(tenant_id, 'expenses.view'));

create policy expense_budgets_insert on public.expense_budgets
for insert to authenticated
with check (public.has_permission(tenant_id, 'expenses.manage_budgets'));

create policy expense_budgets_update on public.expense_budgets
for update to authenticated
using (public.has_permission(tenant_id, 'expenses.manage_budgets'))
with check (public.has_permission(tenant_id, 'expenses.manage_budgets'));

-- No delete policy -- archived (status = 'archived'), never deleted,
-- same convention expense_items/expense_categories already follow.
