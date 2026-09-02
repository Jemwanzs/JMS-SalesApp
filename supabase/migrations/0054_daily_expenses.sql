-- ============================================================================
-- 0054_daily_expenses.sql
--
-- Daily Expenses: a new optional feature (off by default, no billing --
-- a plain tenant_settings.expenses_enabled boolean, exactly like
-- quantity_enabled/notes_field_enabled, not the Inventory add-on's
-- billed-subscription shape) tracking operational expenditure (water,
-- electricity, rent, transport, county fees, ...) strictly separate
-- from stock/inventory acquisition. No FK/join to products,
-- stock_movements, or stock_reconciliations anywhere in this file.
--
-- Two tables, same "config catalog + append-only ledger" split this
-- codebase already uses for products/sales and (for inventory)
-- products/stock_movements:
--
-- expense_items -- the configured catalog (Water, Electricity, Rent,
-- ...), closer to `products`: plain RLS-gated CRUD, archived not
-- hard-deleted so history stays intact if an item is later retired.
--
-- expenses -- the actual recorded spend, closer to `sales`: immutable
-- append-only ledger (denormalized tenant_id, a name snapshot so a
-- later item rename/archive doesn't rewrite history), no UPDATE/DELETE
-- RLS policy ever. Editing/voiding an existing row goes through two
-- SECURITY DEFINER functions below (edit_expense/void_expense),
-- mirroring reverse_sale() in 0026_sale_reversal.sql minus its
-- approval-workflow branch -- deliberately simpler, since this feature
-- is explicitly meant to stay lightweight and expenses carry far lower
-- stakes than a sale reversal.
--
-- Role backfill: RoleService.seedDefaultRoles() only runs once, at
-- tenant creation -- per docs/06-roles-permissions.md's own note (added
-- when 0035 first needed this), any migration adding a new permission
-- key must explicitly backfill role_permissions for existing tenants'
-- system-default roles, or every tenant created before this migration
-- gets the new nav entries with permission-denied on every action.
-- ============================================================================

create table public.expense_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  expense_type text not null check (expense_type in ('recurring', 'one_time')),
  -- A guide only -- never enforced against the actual amount recorded
  -- against this item (spec: "must never force the actual expense
  -- amount"), so no CHECK ties the two together anywhere.
  estimated_amount numeric(12, 2) check (estimated_amount is null or estimated_amount >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_expense_items_tenant on public.expense_items (tenant_id, status);

alter table public.expense_items enable row level security;

-- Anyone in the tenant can see the catalog (same as products_select) --
-- an expenses.create holder without expenses.configure_items still
-- needs to read the list to pick an item when recording an expense.
create policy expense_items_select on public.expense_items
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy expense_items_insert on public.expense_items
for insert to authenticated
with check (public.has_permission(tenant_id, 'expenses.configure_items'));

create policy expense_items_update on public.expense_items
for update to authenticated
using (public.has_permission(tenant_id, 'expenses.configure_items'))
with check (public.has_permission(tenant_id, 'expenses.configure_items'));

-- No delete policy -- archived (status = 'archived'), never deleted,
-- same reasoning products_delete's own absence-of-a-plain-policy note
-- gives: expense records below reference this row and must keep a
-- valid item to join against even after it's retired.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid not null references public.locations (id),
  expense_item_id uuid not null references public.expense_items (id),
  expense_item_name_snapshot text not null,
  actual_amount numeric(12, 2) not null check (actual_amount > 0),
  -- "The date may be changed to a past date only. Do not allow
  -- future-dated expenses" -- enforced here too, not just the form, so
  -- a direct API call can't bypass it either.
  expense_date date not null check (expense_date <= current_date),
  notes text,
  status text not null default 'active' check (status in ('active', 'voided')),
  recorded_by uuid not null references public.profiles (id),
  voided_by uuid references public.profiles (id),
  voided_at timestamptz,
  void_reason text,
  edited_by uuid references public.profiles (id),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_expenses_tenant_date on public.expenses (tenant_id, expense_date desc);
create index idx_expenses_item on public.expenses (tenant_id, expense_item_id);

alter table public.expenses enable row level security;

-- Branch-scoped exactly like sales_select/sales_insert (migration
-- 0051): location_id is NOT NULL here (like sales, unlike the nullable
-- stock_movements/reports), so a plain equality clause against
-- current_active_location() is correct and total. The impersonation
-- carve-out is the same one every branch-scoped policy already needs
-- (Support's Access Workspace has no real branch assignment to resolve).
create policy expenses_select on public.expenses
for select to authenticated
using (
  (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
  and public.has_permission(tenant_id, 'expenses.view')
);

create policy expenses_insert on public.expenses
for insert to authenticated
with check (
  public.has_permission(tenant_id, 'expenses.create')
  and (
    public.impersonated_profile_id(tenant_id) is not null
    or location_id = public.current_active_location(tenant_id)
  )
);

-- Deliberately no UPDATE or DELETE policy -- immutable ledger, exactly
-- like `sales`. edit_expense()/void_expense() below are the only way to
-- change an existing row, each with its own permission check.

create or replace function public.edit_expense(
  p_expense_id uuid,
  p_actual_amount numeric,
  p_expense_date date,
  p_notes text
)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense public.expenses;
  v_actor uuid := auth.uid();
begin
  if p_actual_amount is null or p_actual_amount <= 0 then
    raise exception 'Enter an amount greater than 0';
  end if;
  if p_expense_date is null or p_expense_date > current_date then
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
    raise exception 'Not authorized to edit expenses';
  end if;

  update public.expenses
  set actual_amount = p_actual_amount,
      expense_date = p_expense_date,
      notes = p_notes,
      edited_by = v_actor,
      edited_at = now()
  where id = p_expense_id
  returning * into v_expense;

  return v_expense;
end;
$$;

revoke execute on function public.edit_expense(uuid, numeric, date, text) from public;
grant execute on function public.edit_expense(uuid, numeric, date, text) to authenticated;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expense public.expenses;
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

  update public.expenses
  set status = 'voided',
      voided_by = v_actor,
      voided_at = now(),
      void_reason = p_reason
  where id = p_expense_id
  returning * into v_expense;

  return v_expense;
end;
$$;

revoke execute on function public.void_expense(uuid, text) from public;
grant execute on function public.void_expense(uuid, text) to authenticated;

insert into public.permissions (key, module, description, is_read_only) values
  ('expenses.view', 'expenses', 'View recorded expenses and expense records', true),
  ('expenses.create', 'expenses', 'Record an actual expense against a configured expense item', false),
  ('expenses.edit', 'expenses', 'Edit an already-recorded expense''s amount, date, or notes', false),
  ('expenses.void', 'expenses', 'Void/reverse a recorded expense', false),
  ('expenses.configure_items', 'expenses', 'Create, edit, and archive expense items', false),
  ('expenses.view_analytics', 'expenses', 'View the Expense Summary / Analytics screen', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key in (
    'expenses.view', 'expenses.create', 'expenses.edit',
    'expenses.void', 'expenses.configure_items', 'expenses.view_analytics'
  )
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Supervisor'
  and p.key = 'expenses.view'
on conflict do nothing;

-- Sales User gets nothing here, deliberately -- same "keep Sales
-- simple" principle already applied to inventory.*/stock.* (0035).
