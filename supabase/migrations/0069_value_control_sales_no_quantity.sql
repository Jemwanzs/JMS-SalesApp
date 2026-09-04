-- ============================================================================
-- 0069_value_control_sales_no_quantity.sql
--
-- Product feedback after live-testing the Stock overhaul: a tenant who
-- has set a product's stock_control_method to 'value' ("measure this
-- product's stock by value, not by count") should never be forced to
-- type a per-sale quantity for it -- that requirement only makes sense
-- for a QUANTITY-controlled product. Redefines
-- _stock_deduct_on_sale_insert() (full create-or-replace, never edit an
-- applied migration -- see docs/20) so a value-controlled product's sale
-- deduction infers its own implied quantity from the sale's actual_amount
-- and the product's own expected_price when no quantity was entered,
-- rather than requiring one. If a quantity WAS entered anyway (some
-- tenants may still want per-sale precision even on a value-controlled
-- product), it's still honored as-is -- this only changes what happens
-- when it's absent.
--
-- Nothing else changes: the restore trigger already just mirrors
-- whatever THIS movement recorded, regardless of how its quantity was
-- derived, so void/correct/reverse need no changes at all. The ledger
-- itself stays fully unit-consistent (stock_balances/Overview/
-- reconciliation all keep working exactly as before) -- only the
-- SOURCE of the quantity for a value-controlled sale changes, never the
-- shape of what gets stored.
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

  select tracks_inventory, cost_price, expected_price, name, unit_of_measure, stock_control_method
  into v_product
  from public.products
  where id = new.product_id;

  if not found or not v_product.tracks_inventory then
    return new;
  end if;

  if v_product.stock_control_method = 'value' and (new.quantity is null or new.quantity = 0) then
    if v_product.expected_price is null or v_product.expected_price = 0 then
      raise exception 'Set a selling price for "%" so its sales can be converted to stock value, or enter a quantity for this sale', v_product.name;
    end if;
    v_quantity := new.actual_amount / v_product.expected_price;
  else
    if new.quantity is null or new.quantity = 0 then
      raise exception 'A quantity is required to record a sale of "%", which tracks stock', v_product.name;
    end if;
    v_quantity := new.quantity;
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
