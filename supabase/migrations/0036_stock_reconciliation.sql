-- ============================================================================
-- 0036_stock_reconciliation.sql
--
-- Product Enhancements #4: daily stock reconciliation. Opening + In - Out
-- = Expected Closing; capture Actual; Variance = Actual - Expected;
-- any variance requires a reason before the reconciliation completes.
--
-- A reconciliation must atomically also insert its offsetting
-- stock_movements row (movement_type = 'reconciliation_variance') when
-- there's a variance -- a raw client INSERT into stock_reconciliations
-- could otherwise leave the ledger and the reconciliation row
-- disagreeing (a reconciliation logged with no matching movement, or
-- vice versa). So there is NO insert policy for `authenticated` on this
-- table at all -- the only way in is record_stock_reconciliation()
-- below, following the exact established pattern this codebase already
-- uses for sales.void_sale()/correct_sale() (0006): SECURITY DEFINER
-- (sales/stock_movements both have no RLS write policy a client could
-- use directly, so the function itself does the has_permission() check
-- in code, then writes with the function-owner's privileges), auth.uid()
-- still resolves to the real calling user regardless of security mode
-- (it reads the request's JWT claims, unrelated to function ownership),
-- and the function is explicitly revoked from `public` then granted
-- only to `authenticated`.
-- ============================================================================

create table public.stock_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  location_id uuid references public.locations (id),
  product_id uuid not null references public.products (id),
  reconciliation_date date not null,
  opening_quantity numeric(14, 3) not null,
  stock_in_quantity numeric(14, 3) not null default 0,
  stock_out_quantity numeric(14, 3) not null default 0,
  expected_closing_quantity numeric(14, 3) generated always as (opening_quantity + stock_in_quantity - stock_out_quantity) stored,
  actual_quantity numeric(14, 3) not null,
  variance numeric(14, 3) generated always as (actual_quantity - (opening_quantity + stock_in_quantity - stock_out_quantity)) stored,
  variance_reason text,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  -- Written against the raw (non-generated) columns directly, not the
  -- generated expected_closing_quantity/variance columns, to sidestep
  -- any question of whether a table CHECK can reference a generated
  -- column of the same table at definition time.
  check (variance_reason is not null or actual_quantity = opening_quantity + stock_in_quantity - stock_out_quantity)
);

-- "One reconciliation per product per day" -- a plain UNIQUE(tenant_id,
-- product_id, location_id, reconciliation_date) wouldn't actually
-- enforce this, since Postgres treats every NULL location_id as
-- distinct from every other NULL for uniqueness purposes, and this app
-- doesn't yet have per-location stock UI (every row's location_id is
-- null today) -- a COALESCE-normalized unique index closes that gap.
create unique index idx_stock_reconciliations_unique_per_day
  on public.stock_reconciliations (tenant_id, product_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), reconciliation_date);

create index idx_stock_reconciliations_tenant_date on public.stock_reconciliations (tenant_id, reconciliation_date desc);

alter table public.stock_reconciliations enable row level security;

create policy stock_reconciliations_select on public.stock_reconciliations
for select to authenticated
using (public.has_permission(tenant_id, 'inventory.view'));
-- No insert/update/delete policy -- see header comment.

create or replace function public.record_stock_reconciliation(
  p_tenant_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_reconciliation_date date,
  p_actual_quantity numeric,
  p_variance_reason text
)
returns public.stock_reconciliations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_opening numeric;
  v_in numeric;
  v_out numeric;
  v_expected numeric;
  v_variance numeric;
  v_product record;
  v_row public.stock_reconciliations;
  v_null_location constant uuid := '00000000-0000-0000-0000-000000000000';
begin
  if not public.has_permission(p_tenant_id, 'stock.reconcile') then
    raise exception 'Not authorized to reconcile stock';
  end if;

  select name, unit_of_measure into v_product
  from public.products
  where id = p_product_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Product not found';
  end if;

  -- Opening = balance as of the close of the day before this
  -- reconciliation date (every movement strictly before it).
  select coalesce(sum(quantity), 0) into v_opening from public.stock_movements
    where tenant_id = p_tenant_id and product_id = p_product_id
      and coalesce(location_id, v_null_location) = coalesce(p_location_id, v_null_location)
      and occurred_on < p_reconciliation_date;

  select coalesce(sum(quantity), 0) into v_in from public.stock_movements
    where tenant_id = p_tenant_id and product_id = p_product_id
      and coalesce(location_id, v_null_location) = coalesce(p_location_id, v_null_location)
      and occurred_on = p_reconciliation_date and quantity > 0;

  select coalesce(sum(-quantity), 0) into v_out from public.stock_movements
    where tenant_id = p_tenant_id and product_id = p_product_id
      and coalesce(location_id, v_null_location) = coalesce(p_location_id, v_null_location)
      and occurred_on = p_reconciliation_date and quantity < 0;

  v_expected := v_opening + v_in - v_out;
  v_variance := p_actual_quantity - v_expected;

  if v_variance <> 0 and (p_variance_reason is null or length(trim(p_variance_reason)) = 0) then
    raise exception 'A reason is required when there is a variance';
  end if;

  insert into public.stock_reconciliations
    (tenant_id, product_id, location_id, reconciliation_date, opening_quantity, stock_in_quantity, stock_out_quantity, actual_quantity, variance_reason, recorded_by)
  values (
    p_tenant_id, p_product_id, p_location_id, p_reconciliation_date,
    v_opening, v_in, v_out, p_actual_quantity, nullif(trim(p_variance_reason), ''), auth.uid()
  )
  returning * into v_row;

  if v_variance <> 0 then
    insert into public.stock_movements
      (tenant_id, product_id, location_id, product_name_snapshot, unit_of_measure_snapshot, movement_type, quantity, reason, reference_type, reference_id, recorded_by, occurred_on)
    values (
      p_tenant_id, p_product_id, p_location_id, v_product.name, coalesce(v_product.unit_of_measure, 'units'),
      'reconciliation_variance', v_variance, p_variance_reason, 'reconciliation', v_row.id, auth.uid(), p_reconciliation_date
    );
  end if;

  return v_row;
end;
$$;

revoke execute on function public.record_stock_reconciliation(uuid, uuid, uuid, date, numeric, text) from public;
grant execute on function public.record_stock_reconciliation(uuid, uuid, uuid, date, numeric, text) to authenticated;
