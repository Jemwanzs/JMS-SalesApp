-- ============================================================================
-- 0071_quantity_toggle_is_sole_authority.sql
--
-- Product feedback after live testing: a tenant's own Settings ->
-- Quantity field toggle must be the SOLE authority over whether a sale
-- asks for a quantity at all -- migration 0069 still let a quantity-
-- controlled tracked product force the field visible/required,
-- overriding a tenant who had explicitly turned the toggle off. That
-- was backwards: the toggle is the tenant's own business decision
-- ("we don't track per-sale quantity"), not something a product's own
-- configuration should override in either direction.
--
-- Fix: the sale-insert deduction trigger no longer treats
-- stock_control_method as the deciding factor for whether it needs an
-- explicit quantity. For ANY tracked product (quantity- or value-
-- controlled alike), a given quantity is used as-is; when none is
-- given, an implied quantity is inferred from actual_amount /
-- products.expected_price, exactly as 0069 already did for value-
-- controlled products specifically -- now universal. Application-layer
-- changes (record-sale-dialog.tsx no longer forces the field visible/
-- required for any product, SalesService.recordSale no longer
-- rejects a tracked sale with no quantity) ship alongside this
-- migration, not here.
-- ============================================================================

create or replace function public._stock_deduct_on_sale_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product record;
  v_quantity numeric;
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

  if new.quantity is not null and new.quantity <> 0 then
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
