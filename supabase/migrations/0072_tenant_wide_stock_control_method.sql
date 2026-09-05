-- ============================================================================
-- 0072_tenant_wide_stock_control_method.sql
--
-- Product feedback: stock_control_method belongs at the TENANT level,
-- not per-product. A business tracks its stock by value or by count as
-- a whole, coherent policy -- not product-by-product -- and a per-
-- product setting is exactly what caused the previous confusion (a
-- product's own configuration silently overriding the tenant's own
-- Settings toggle). Moves the choice to tenant_settings (key
-- `stock_control_method`, 'value' | 'quantity', default 'value' when
-- unset -- a genuine default change: this feature is brand new, so no
-- real tenant has ever relied on the old per-product default of
-- 'quantity'). products.stock_control_method is dropped outright, not
-- deprecated -- confirmed no real product on either live tenant had it
-- set to anything but that same old default.
--
-- Behavior once QTY is selected: quantity becomes MANDATORY for a
-- tracked product's sale (enforced here as a hard backstop; the UI/
-- SalesService layers enforce it too, shipped alongside this
-- migration) -- untracked products are unaffected either way. Once
-- Monetary Value (the default) is selected: unchanged from 0071 -- a
-- given quantity is used as-is, an absent one is inferred from
-- actual_amount / products.expected_price. This also governs Stock In/
-- Adjustments (StockService.recordMovement, application-layer change)
-- and stock_reconciliations' value-vs-quantity branch below.
-- ============================================================================

alter table public.products drop column if exists stock_control_method;

-- ----------------------------------------------------------------------------
-- record_stock_reconciliation(): identical to 0068's version except the
-- value/quantity branch now reads the TENANT's stock_control_method
-- instead of the product's own (now-removed) column.
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
  v_method text;
begin
  if not public.has_permission(p_tenant_id, 'stock.reconcile') then
    raise exception 'Not authorized to reconcile stock';
  end if;

  select name, unit_of_measure, cost_price, expected_price into v_product
  from public.products
  where id = p_product_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'Product not found';
  end if;

  select coalesce(value #>> '{}', 'value') into v_method
    from public.tenant_settings where tenant_id = p_tenant_id and setting_key = 'stock_control_method';
  v_method := coalesce(v_method, 'value');

  if v_method = 'quantity' and p_actual_quantity is null then
    raise exception 'An actual physical count is required for a quantity-controlled tenant';
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

  if p_actual_quantity is not null then
    v_variance := p_actual_quantity - v_expected;
    if v_variance <> 0 and (p_variance_reason is null or length(trim(p_variance_reason)) = 0) then
      raise exception 'A reason is required when there is a variance';
    end if;
  else
    v_variance := null;
  end if;

  if v_method = 'value' then
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

  select coalesce((value)::text::numeric, 2) into v_tolerance_pct
    from public.tenant_settings where tenant_id = p_tenant_id and setting_key = 'stock_variance_tolerance_percent';
  v_tolerance_pct := coalesce(v_tolerance_pct, 2);

  select coalesce((value)::text::numeric, 0) into v_tolerance_amt
    from public.tenant_settings where tenant_id = p_tenant_id and setting_key = 'stock_variance_tolerance_amount';
  v_tolerance_amt := coalesce(v_tolerance_amt, 0);

  if v_method = 'value' then
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

  if v_variance is not null and v_variance <> 0 then
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
-- _stock_deduct_on_sale_insert(): the tenant's stock_control_method now
-- decides whether an explicit quantity is REQUIRED (quantity mode) or
-- merely preferred-if-given, inferred-if-not (value mode, the default).
-- ----------------------------------------------------------------------------

create or replace function public._stock_deduct_on_sale_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product record;
  v_quantity numeric;
  v_method text;
begin
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

  select coalesce(value #>> '{}', 'value') into v_method
    from public.tenant_settings where tenant_id = new.tenant_id and setting_key = 'stock_control_method';
  v_method := coalesce(v_method, 'value');

  if v_method = 'quantity' then
    if new.quantity is null or new.quantity = 0 then
      raise exception 'A quantity is required to record a sale of "%", which tracks stock', v_product.name;
    end if;
    v_quantity := new.quantity;
  elsif new.quantity is not null and new.quantity <> 0 then
    v_quantity := new.quantity;
  else
    if v_product.expected_price is null or v_product.expected_price = 0 then
      raise exception 'Set a selling price for "%" so its sales can be converted to stock quantity, or enter a quantity for this sale', v_product.name;
    end if;
    v_quantity := new.actual_amount / v_product.expected_price;
  end if;

  insert into public.stock_movements (
    tenant_id, location_id, product_id, product_name_snapshot, unit_of_measure_snapshot,
    movement_type, quantity, unit_cost_snapshot, unit_price_snapshot,
    reference_type, reference_id, recorded_by, occurred_on
  ) values (
    new.tenant_id, new.location_id, new.product_id, v_product.name, coalesce(v_product.unit_of_measure, 'units'),
    'sale', -abs(v_quantity), v_product.cost_price, v_product.expected_price,
    'sale', new.id, coalesce(auth.uid(), new.recorded_by), new.sale_date
  )
  on conflict (tenant_id, product_id, reference_id, movement_type) where reference_type = 'sale' do nothing;

  return new;
end;
$$;

revoke execute on function public._stock_deduct_on_sale_insert() from public, authenticated;
