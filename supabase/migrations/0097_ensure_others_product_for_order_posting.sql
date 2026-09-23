-- ============================================================================
-- 0097_ensure_others_product_for_order_posting.sql
--
-- Live verification of 0096 caught a real gap: `_post_order_to_sales`
-- hard-failed ("tenant has no 'Others' product to fall back to") for
-- MaliSafi, which turns out to have NO `is_system = true` product at
-- all despite having 21 real ones -- because `ensureOthersProduct()`
-- (services/ProductService.ts:175-201) only runs alongside
-- ProductService.create(), and MaliSafi's catalogue was seeded via a
-- direct script insert that bypassed it. "Others" is genuinely NOT
-- guaranteed to exist for every tenant, just usually true for ones
-- that have used the real product-creation UI -- too fragile a thing
-- for order completion to depend on.
--
-- Fix: `_post_order_to_sales` now ensures the row itself (mirroring
-- ensureOthersProduct's exact insert shape) instead of raising when
-- it's missing, so an order with an unresolvable order_product_id can
-- never block completion on an unrelated product-catalogue gap.
-- ============================================================================

create or replace function public._post_order_to_sales(p_order_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_location_id uuid;
  v_location_timezone text;
  v_business_day_id uuid;
  v_business_date date;
  v_others_product_id uuid;
  v_item record;
  v_resolved_product_id uuid;
  v_resolved_product_name text;
  v_resolved_product_image text;
  v_resolved_product_price numeric;
  v_use_product_id uuid;
  v_name_snapshot text;
  v_image_snapshot text;
  v_price_snapshot numeric;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order not found';
  end if;

  select id, timezone into v_location_id, v_location_timezone
  from public.locations
  where tenant_id = v_order.tenant_id
  order by created_at asc
  limit 1;

  if v_location_id is null then
    raise exception 'Cannot post order to Sales: tenant has no locations';
  end if;

  v_business_date := (v_order.completed_at at time zone coalesce(v_location_timezone, 'UTC'))::date;
  v_business_day_id := public._resolve_or_create_closed_business_day(v_order.tenant_id, v_location_id, v_business_date);

  select id into v_others_product_id
  from public.products
  where tenant_id = v_order.tenant_id and is_system = true
  limit 1;

  -- Ensure, not just check -- same idempotent shape ProductService.
  -- ensureOthersProduct() uses (products_one_system_per_tenant,
  -- migration 0032, makes a concurrent double-insert harmless).
  if v_others_product_id is null then
    insert into public.products (tenant_id, name, is_system, status, show_expected_price, show_name_in_photo_view, display_order, created_by)
    values (v_order.tenant_id, 'Others', true, 'active', false, true, 0, p_actor)
    on conflict do nothing;

    select id into v_others_product_id
    from public.products
    where tenant_id = v_order.tenant_id and is_system = true
    limit 1;
  end if;

  for v_item in
    select oi.id, oi.order_product_id, oi.product_name_snapshot, oi.product_image_snapshot, oi.requested_amount
    from public.order_items oi
    where oi.order_id = p_order_id
  loop
    v_use_product_id := null;
    v_resolved_product_id := null;
    v_resolved_product_name := null;
    v_resolved_product_image := null;
    v_resolved_product_price := null;

    if v_item.order_product_id is not null then
      select p.id, p.name, p.image_url, p.expected_price
      into v_resolved_product_id, v_resolved_product_name, v_resolved_product_image, v_resolved_product_price
      from public.order_products op
      join public.products p on p.id = op.product_id
      where op.id = v_item.order_product_id and op.tenant_id = v_order.tenant_id;
    end if;

    if v_resolved_product_id is not null then
      v_use_product_id := v_resolved_product_id;
      v_name_snapshot := v_resolved_product_name;
      v_image_snapshot := v_resolved_product_image;
      v_price_snapshot := v_resolved_product_price;
    else
      if v_others_product_id is null then
        raise exception 'Cannot post order to Sales: could not resolve or create an "Others" product';
      end if;
      v_use_product_id := v_others_product_id;
      v_name_snapshot := v_item.product_name_snapshot;
      v_image_snapshot := v_item.product_image_snapshot;
      v_price_snapshot := null;
    end if;

    insert into public.sales (
      tenant_id, location_id, business_day_id, product_id,
      product_name_snapshot, product_image_snapshot, expected_price_snapshot,
      actual_amount, quantity, notes, recorded_by, sale_date,
      idempotency_key, source_order_item_id
    ) values (
      v_order.tenant_id, v_location_id, v_business_day_id, v_use_product_id,
      v_name_snapshot, v_image_snapshot, v_price_snapshot,
      v_item.requested_amount, null, 'Posted from Order #' || coalesce(v_order.order_number, p_order_id::text), p_actor, v_business_date,
      gen_random_uuid(), v_item.id
    )
    on conflict (source_order_item_id) where source_order_item_id is not null do nothing;
  end loop;
end;
$$;

revoke execute on function public._post_order_to_sales(uuid, uuid) from public, authenticated;
