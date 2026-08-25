-- ============================================================================
-- 0035_inventory_core_schema.sql
--
-- Product Enhancements #3/#4/#5/#6: the actual inventory data model --
-- UOM columns on products, an immutable append-only stock ledger
-- (mirrors `sales`'s own pattern exactly: denormalized tenant_id,
-- snapshot columns, no UPDATE/DELETE policy ever -- corrections are new
-- offsetting rows, never a raw mutation), and a plain (non-materialized)
-- view for current balances.
--
-- unit_of_measure stores either a canonical code from a static
-- TypeScript-level list (lib/inventory/units-of-measure.ts) or, when
-- unit_of_measure_is_custom = true, the tenant's free-typed label -- no
-- new DB table for the UOM catalog itself, a closed product-level
-- labeling concern with no per-tenant configurability need beyond the
-- free-text escape hatch.
--
-- Role backfill: RoleService.seedDefaultRoles() only runs once, at
-- tenant creation, computing "Tenant Administrator = every permission
-- in the catalog AT THAT MOMENT" -- no migration in this repo has ever
-- backfilled role_permissions for pre-existing tenants when adding a
-- new permission key, so without an explicit backfill here, every
-- tenant created before this migration would see the new Settings
-- toggle and Stock nav item but get permission-denied on every action.
-- ============================================================================

alter table public.products add column tracks_inventory boolean not null default false;
alter table public.products add column unit_of_measure text;
alter table public.products add column unit_of_measure_is_custom boolean not null default false;
alter table public.products add column low_stock_threshold numeric(14, 3);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid references public.locations (id),
  product_id uuid not null references public.products (id),
  product_name_snapshot text not null,
  unit_of_measure_snapshot text not null,
  movement_type text not null check (movement_type in (
    'opening_stock', 'stock_in', 'stock_out',
    'adjustment_increase', 'adjustment_decrease',
    'damaged', 'expired', 'lost', 'reconciliation_variance'
  )),
  -- Signed: positive increases the balance (opening_stock, stock_in,
  -- adjustment_increase, a positive reconciliation_variance), negative
  -- decreases it (stock_out, damaged, expired, lost,
  -- adjustment_decrease, a negative reconciliation_variance) -- single
  -- source of truth for the sign convention, so current balance is a
  -- plain SUM with no CASE-per-type logic anywhere it's read.
  quantity numeric(14, 3) not null check (quantity <> 0),
  reason text,
  reference_type text check (reference_type in ('manual', 'reconciliation')),
  reference_id uuid,
  recorded_by uuid not null references public.profiles (id),
  occurred_on date not null default current_date,
  created_at timestamptz not null default now(),
  check (
    movement_type not in ('adjustment_increase', 'adjustment_decrease', 'damaged', 'expired', 'lost', 'reconciliation_variance')
    or reason is not null
  )
);

create index idx_stock_movements_product_date on public.stock_movements (tenant_id, product_id, occurred_on);
create index idx_stock_movements_tenant_date on public.stock_movements (tenant_id, occurred_on desc);

alter table public.stock_movements enable row level security;

create policy stock_movements_select on public.stock_movements
for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy stock_movements_insert on public.stock_movements
for insert to authenticated
with check (
  (movement_type = 'reconciliation_variance' and public.has_permission(tenant_id, 'stock.reconcile'))
  or (movement_type <> 'reconciliation_variance' and public.has_permission(tenant_id, 'stock.movement.record'))
);
-- Deliberately no update/delete policy -- immutable, exactly like `sales`.

-- Plain view, not materialized -- movement volume for small-business
-- daily stock is modest, so avoiding refresh staleness entirely is
-- worth more than the marginal query cost; revisit only if a real
-- performance problem shows up. Postgres views default to
-- security_invoker, so stock_movements_select's own RLS transparently
-- governs this too -- no separate policy needed on the view itself.
create view public.stock_balances as
select tenant_id, product_id, location_id,
       sum(quantity) as balance,
       max(occurred_on) as last_movement_date
from public.stock_movements
group by tenant_id, product_id, location_id;

insert into public.permissions (key, module, description, is_read_only) values
  ('inventory.view', 'inventory', 'View stock balances, movement history, and inventory reports', true),
  ('inventory.manage', 'inventory', 'Configure per-product stock tracking and unit of measure', false),
  ('stock.movement.record', 'inventory', 'Record stock in/out, adjustments, damaged/expired/lost stock', false),
  ('stock.reconcile', 'inventory', 'Perform daily stock reconciliation / physical counts', false);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key in ('inventory.view', 'inventory.manage', 'stock.movement.record', 'stock.reconcile')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Supervisor'
  and p.key = 'inventory.view'
on conflict do nothing;
