-- ============================================================================
-- 0067_stock_value_tracking_and_sales_integration.sql
--
-- Robust Stock/Inventory Management, part 1: schema + the Sales<->Stock
-- integration. See docs/21-inventory-management.md for the full design
-- (updated alongside this migration).
--
-- CORE DESIGN DECISION: quantity-based and value-based stock control are
-- two REPORTING LENSES over the same stock_movements ledger, not two
-- parallel ledgers -- every movement still records a signed `quantity`
-- exactly as migration 0035 established; what's new is that each row also
-- snapshots the product's cost/selling price AT THAT MOMENT
-- (unit_cost_snapshot/unit_price_snapshot), so a monetary value can always
-- be derived without ever re-reading the product's CURRENT price. This is
-- also what keeps reconciliation history snapshot-safe (a later price
-- change on the product must never retroactively change what a past
-- reconciliation reported). products.stock_control_method only decides
-- which numbers the UI foregrounds for a given product -- no duplicate
-- source of truth for stock balances.
--
-- SALES INTEGRATION: implemented as two triggers on `sales`, not as
-- application-layer calls from SalesService -- confirmed necessary by
-- reading void_sale/correct_sale/reverse_sale (0006/0026) directly: all
-- three can defer their actual effect to resolve_approval_request() when
-- the tenant requires sign-off, so a TypeScript-side hook in SalesService
-- would silently miss the deferred-approval path. A trigger fires on the
-- real row mutation regardless of which code path produced it:
--   - AFTER INSERT deducts stock for any new `sales` row representing a
--     real consumption of tracked stock (ordinary recordSale inserts AND
--     a correction's replacement row) -- but explicitly SKIPS a reversal's
--     replacement row (identified by reversal_of_sale_id is not null),
--     since that row exists only to zero out revenue, not to represent a
--     new physical sale of goods.
--   - AFTER UPDATE OF status restores stock when a sale transitions out of
--     'open' (voided/corrected/reversed), by looking up whatever this
--     SAME row's own 'sale' movement actually recorded (not re-deriving
--     eligibility from products.tracks_inventory, which could have
--     changed since) -- so a correction nets out correctly with zero
--     special-casing: restore the original's full amount, then the
--     insert-trigger deducts the replacement's new amount, and the two
--     movements net to exactly the right delta.
-- A partial unique index makes both triggers idempotent (on conflict do
-- nothing) -- "a transaction syncing twice must not deduct stock twice."
-- ============================================================================

-- ----------------------------------------------------------------------------
-- products: cost price (distinct from the existing expected_price selling
-- price) + per-product control method.
-- ----------------------------------------------------------------------------

alter table public.products add column cost_price numeric(12, 2);
alter table public.products add column stock_control_method text not null default 'quantity'
  check (stock_control_method in ('quantity', 'value'));

-- ----------------------------------------------------------------------------
-- stock_movements: snapshot columns + widened movement_type/reference_type
-- + idempotency index for sale-driven rows.
-- ----------------------------------------------------------------------------

alter table public.stock_movements add column unit_cost_snapshot numeric(12, 2);
alter table public.stock_movements add column unit_price_snapshot numeric(12, 2);

-- migration 0035 wrote both checks inline, right after each column's own
-- type declaration -- Postgres auto-names an unnamed COLUMN-level check
-- exactly `{table}_{column}_check`, deterministically, so these two exact
-- names are known, not guessed. (An earlier version of this migration
-- tried to find them by fuzzy-matching pg_get_constraintdef() text, which
-- also matched the unrelated "reason required" check further down this
-- same table -- both definitions contain "movement_type" and "in" as
-- substrings -- and without an ORDER BY, an unordered SELECT INTO could
-- grab either one. Direct DROP CONSTRAINT IF EXISTS on the known name
-- removes that ambiguity entirely.)
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;

alter table public.stock_movements add constraint stock_movements_movement_type_check
  check (movement_type in (
    'opening_stock', 'stock_in', 'stock_out',
    'adjustment_increase', 'adjustment_decrease',
    'damaged', 'expired', 'lost', 'reconciliation_variance',
    'sale', 'sale_reversal'
  ));

alter table public.stock_movements drop constraint if exists stock_movements_reference_type_check;

alter table public.stock_movements add constraint stock_movements_reference_type_check
  check (reference_type in ('manual', 'reconciliation', 'sale'));

create unique index idx_stock_movements_sale_idempotency
  on public.stock_movements (tenant_id, product_id, reference_id, movement_type)
  where reference_type = 'sale';

-- ----------------------------------------------------------------------------
-- stock_reconciliations: value-side columns (populated only for
-- stock_control_method = 'value' products, mirroring how location_id is
-- already nullable-by-scope) + a stored status classification so a later
-- tolerance-setting change never retroactively reclassifies old history.
-- ----------------------------------------------------------------------------

alter table public.stock_reconciliations add column opening_value numeric(12, 2);
alter table public.stock_reconciliations add column stock_added_value numeric(12, 2);
alter table public.stock_reconciliations add column expected_sales_value numeric(12, 2)
  generated always as (opening_value + stock_added_value) stored;
alter table public.stock_reconciliations add column actual_recorded_sales numeric(12, 2);
alter table public.stock_reconciliations add column actual_remaining_value numeric(12, 2);
alter table public.stock_reconciliations add column valid_adjustments_value numeric(12, 2) not null default 0;
alter table public.stock_reconciliations add column unexplained_variance_value numeric(12, 2)
  generated always as (
    case when opening_value is null then null
      else (opening_value + stock_added_value) - coalesce(actual_recorded_sales, 0) - coalesce(actual_remaining_value, 0) - valid_adjustments_value
    end
  ) stored;
alter table public.stock_reconciliations add column status text;

-- ----------------------------------------------------------------------------
-- record_stock_reconciliation(): full redefinition (never edit an applied
-- migration -- see docs/20). Adds the value-side branch (only when the
-- product's stock_control_method = 'value') and the tolerance-based
-- status classification for BOTH methods. Quantity-side arithmetic is
-- byte-identical to 0036's version.
-- ----------------------------------------------------------------------------

create or replace function public.record_stock_reconciliation(
  p_tenant_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_reconciliation_date date,
  p_actual_quantity numeric,
  p_variance_reason text,
  p_actual_recorded_sales numeric default null,
  p_actual_remaining_value numeric default null,
  p_valid_adjustments_value numeric default 0
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
  v_opening_value numeric;
  v_added_value numeric;
  v_unexplained_value numeric;
  v_tolerance_pct numeric;
  v_tolerance_amt numeric;
  v_status text;
  v_check_amount numeric;
  v_check_basis numeric;
begin
  if not public.has_permission(p_tenant_id, 'stock.reconcile') then
    raise exception 'Not authorized to reconcile stock';
  end if;

  select name, unit_of_measure, stock_control_method, cost_price, expected_price into v_product
  from public.products
  where id = p_product_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Product not found';
  end if;

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

  -- Value-side: only meaningful for a 'value' control-method product.
  -- Opening/added value derived from the SAME movements' own snapshot
  -- prices (never today's live product price), using selling-price
  -- snapshot as the "value" basis per the confirmed decision (Expected
  -- Sales Value = stock consumed valued at its own selling price).
  if v_product.stock_control_method = 'value' then
    select coalesce(sum(quantity * coalesce(unit_price_snapshot, 0)), 0) into v_opening_value
      from public.stock_movements
      where tenant_id = p_tenant_id and product_id = p_product_id
        and coalesce(location_id, v_null_location) = coalesce(p_location_id, v_null_location)
        and occurred_on < p_reconciliation_date;

    select coalesce(sum(quantity * coalesce(unit_price_snapshot, 0)), 0) into v_added_value
      from public.stock_movements
      where tenant_id = p_tenant_id and product_id = p_product_id
        and coalesce(location_id, v_null_location) = coalesce(p_location_id, v_null_location)
        and occurred_on = p_reconciliation_date and quantity > 0;

    v_unexplained_value := (v_opening_value + v_added_value)
      - coalesce(p_actual_recorded_sales, 0) - coalesce(p_actual_remaining_value, 0) - coalesce(p_valid_adjustments_value, 0);
  end if;

  -- Tolerance-based status, snapshotted at write time (a later tenant_settings
  -- change must never retroactively reclassify this row).
  select coalesce((value)::text::numeric, 2) into v_tolerance_pct
    from public.tenant_settings where tenant_id = p_tenant_id and setting_key = 'stock_variance_tolerance_percent';
  v_tolerance_pct := coalesce(v_tolerance_pct, 2);

  select coalesce((value)::text::numeric, 0) into v_tolerance_amt
    from public.tenant_settings where tenant_id = p_tenant_id and setting_key = 'stock_variance_tolerance_amount';
  v_tolerance_amt := coalesce(v_tolerance_amt, 0);

  if v_product.stock_control_method = 'value' then
    v_check_amount := abs(v_unexplained_value);
    v_check_basis := abs(v_opening_value + v_added_value);
  else
    v_check_amount := abs(v_variance);
    v_check_basis := abs(v_expected);
  end if;

  if v_check_amount = 0 then
    v_status := 'balanced';
  elsif v_check_amount <= v_tolerance_amt or (v_check_basis > 0 and v_check_amount / v_check_basis * 100 <= v_tolerance_pct) then
    v_status := 'within_tolerance';
  elsif v_check_amount <= v_tolerance_amt * 2 or (v_check_basis > 0 and v_check_amount / v_check_basis * 100 <= v_tolerance_pct * 2) then
    v_status := 'variance';
  else
    v_status := 'material_variance';
  end if;

  insert into public.stock_reconciliations
    (tenant_id, product_id, location_id, reconciliation_date, opening_quantity, stock_in_quantity, stock_out_quantity,
     actual_quantity, variance_reason, recorded_by,
     opening_value, stock_added_value, actual_recorded_sales, actual_remaining_value, valid_adjustments_value, status)
  values (
    p_tenant_id, p_product_id, p_location_id, p_reconciliation_date,
    v_opening, v_in, v_out, p_actual_quantity, nullif(trim(p_variance_reason), ''), auth.uid(),
    v_opening_value, v_added_value, p_actual_recorded_sales, p_actual_remaining_value, coalesce(p_valid_adjustments_value, 0), v_status
  )
  returning * into v_row;

  if v_variance <> 0 then
    insert into public.stock_movements
      (tenant_id, product_id, location_id, product_name_snapshot, unit_of_measure_snapshot, movement_type, quantity,
       unit_cost_snapshot, unit_price_snapshot, reason, reference_type, reference_id, recorded_by, occurred_on)
    values (
      p_tenant_id, p_product_id, p_location_id, v_product.name, coalesce(v_product.unit_of_measure, 'units'),
      'reconciliation_variance', v_variance, v_product.cost_price, v_product.expected_price,
      p_variance_reason, 'reconciliation', v_row.id, auth.uid(), p_reconciliation_date
    );
  end if;

  return v_row;
end;
$$;

revoke execute on function public.record_stock_reconciliation(uuid, uuid, uuid, date, numeric, text, numeric, numeric, numeric) from public;
grant execute on function public.record_stock_reconciliation(uuid, uuid, uuid, date, numeric, text, numeric, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- Sales <-> Stock integration triggers.
-- ----------------------------------------------------------------------------

create or replace function public._stock_deduct_on_sale_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product record;
begin
  -- Reversal replacement rows exist only to zero out revenue -- their
  -- stock effect (restoring the ORIGINAL sale's deduction) is handled
  -- entirely by the status-change trigger below, keyed off the original
  -- row. Deducting here too would double-count.
  if new.reversal_of_sale_id is not null then
    return new;
  end if;

  select tracks_inventory, cost_price, expected_price, name, unit_of_measure
  into v_product
  from public.products
  where id = new.product_id;

  if not found or not v_product.tracks_inventory then
    return new;
  end if;

  if new.quantity is null or new.quantity = 0 then
    raise exception 'A quantity is required to record a sale of "%", which tracks stock', v_product.name;
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, product_name_snapshot, unit_of_measure_snapshot,
    movement_type, quantity, unit_cost_snapshot, unit_price_snapshot,
    reference_type, reference_id, recorded_by, occurred_on
  ) values (
    new.tenant_id, new.location_id, new.product_id, v_product.name, coalesce(v_product.unit_of_measure, 'units'),
    'sale', -abs(new.quantity), v_product.cost_price, v_product.expected_price,
    'sale', new.id, coalesce(auth.uid(), new.recorded_by), new.sale_date
  )
  on conflict (tenant_id, product_id, reference_id, movement_type) where reference_type = 'sale' do nothing;

  return new;
end;
$$;

revoke execute on function public._stock_deduct_on_sale_insert() from public, authenticated;

create trigger stock_deduct_on_sale_insert
after insert on public.sales
for each row execute function public._stock_deduct_on_sale_insert();

create or replace function public._stock_restore_on_sale_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original_movement public.stock_movements;
begin
  select * into v_original_movement
  from public.stock_movements
  where tenant_id = new.tenant_id and product_id = new.product_id
    and reference_type = 'sale' and reference_id = new.id and movement_type = 'sale'
  limit 1;

  if not found then
    return new;
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, product_name_snapshot, unit_of_measure_snapshot,
    movement_type, quantity, unit_cost_snapshot, unit_price_snapshot, reason,
    reference_type, reference_id, recorded_by, occurred_on
  ) values (
    v_original_movement.tenant_id, v_original_movement.location_id, v_original_movement.product_id,
    v_original_movement.product_name_snapshot, v_original_movement.unit_of_measure_snapshot,
    'sale_reversal', abs(v_original_movement.quantity), v_original_movement.unit_cost_snapshot, v_original_movement.unit_price_snapshot,
    'Automatic: sale ' || new.status,
    'sale', new.id, coalesce(auth.uid(), new.recorded_by), new.sale_date
  )
  on conflict (tenant_id, product_id, reference_id, movement_type) where reference_type = 'sale' do nothing;

  return new;
end;
$$;

revoke execute on function public._stock_restore_on_sale_status_change() from public, authenticated;

create trigger stock_restore_on_sale_status_change
after update of status on public.sales
for each row
when (old.status = 'open' and new.status in ('voided', 'corrected', 'reversed'))
execute function public._stock_restore_on_sale_status_change();

-- ----------------------------------------------------------------------------
-- Backfill note: existing stock_movements rows keep location_id = null
-- (no reliable way to know which branch a historical row belonged to --
-- RLS already treats null as visible from any branch, see 0051's header
-- comment) and null unit_cost_snapshot/unit_price_snapshot (no historical
-- price data to snapshot retroactively). Both self-heal going forward:
-- every new write from this point on populates them correctly.
-- ----------------------------------------------------------------------------
