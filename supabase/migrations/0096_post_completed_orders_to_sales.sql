-- ============================================================================
-- 0096_post_completed_orders_to_sales.sql
--
-- CUSTOMER ORDERS MODULE — COMPLETED ORDERS → DAILY SALES.
--
-- Every prior Orders migration's own header explicitly forbade touching
-- Sales/Stock/Inventory. This one is a deliberate, explicit exception,
-- requested directly: when an order is marked Completed, post each
-- order_items row as a normal `sales` row, EXACTLY ONCE, so it flows
-- through the existing Daily Sales / Analytics / Reports / Product
-- Performance pipeline with zero new reporting code -- "do not create
-- a separate sales-reporting engine for Orders."
--
-- THE LOCATION TENSION: `sales.location_id`/`business_day_id` are both
-- NOT NULL (0005), but Orders is deliberately tenant-wide with no
-- location concept at all (0092's own header comment). Confirmed with
-- the user: post to the tenant's PRIMARY location (oldest-created --
-- the same "default location" idiom TenantService.getPrimaryLocation
-- already uses elsewhere), automatically, no new settings surface.
--
-- THE BUSINESS-DAY TENSION: a location only has a live OPEN business
-- day during its configured hours (the pg_cron sweep, 0011) -- an
-- order can complete at any time, so posting can't assume one is open.
-- Reuses the exact "resolve-or-create a CLOSED business day" shape
-- resolve_backdated_business_day (0090) established for exactly this
-- problem, dated to the order's completed_at::date -- but as its OWN
-- smaller helper (_resolve_or_create_closed_business_day below), not a
-- call to resolve_backdated_business_day itself: that function also
-- gates on `sales.record_backdated` + the sale_date_selection_enabled
-- tenant setting, both specific to the manual-backdating FEATURE's own
-- authorization model and irrelevant to automatic order-posting (the
-- staff member completing an order shouldn't need an unrelated Sales
-- permission just for that to work).
--
-- IDEMPOTENCY IS STRUCTURALLY FREE: complete_order() already guards
-- `if v_order.status <> 'on_delivery' then raise exception` -- the
-- status transition (and therefore posting, placed INSIDE that same
-- transaction) can only ever run once per order. The partial unique
-- index on sales.source_order_item_id below is the real, DB-enforced
-- backstop on top of that structural guarantee -- belt and suspenders,
-- not the only thing preventing a double-post.
--
-- QUANTITY: sales.quantity stays null for every order-derived row --
-- the existing stock-deduction trigger (0071) already infers an
-- implied quantity from actual_amount / products.expected_price for
-- ANY tracked product with no quantity given, exactly the behavior
-- confirmed as acceptable for Orders' amount-only model. (Pre-existing
-- constraint inherited as-is, not new: a tracked product with NO
-- expected_price configured would still make that trigger raise,
-- exactly as it already would for a normal staff-recorded sale of the
-- same product -- Orders doesn't introduce this risk, it inherits it.)
-- ============================================================================

alter table public.sales add column source_order_item_id uuid references public.order_items (id);

create unique index sales_source_order_item_unique
  on public.sales (source_order_item_id)
  where source_order_item_id is not null;

alter table public.orders add column posted_to_sales boolean not null default false;

-- Resolve-or-create a CLOSED business day for (tenant, location, date)
-- -- no permission/tenant-setting gate, unlike resolve_backdated_
-- business_day, since this is an internal helper only ever called from
-- inside another security definer function (post_order_to_sales
-- below), never directly by a client. Identical resolve-or-create
-- shape to 0090/0078's own precedent.
create or replace function public._resolve_or_create_closed_business_day(
  p_tenant_id uuid,
  p_location_id uuid,
  p_business_date date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day public.business_days;
begin
  select * into v_day
  from public.business_days
  where tenant_id = p_tenant_id and location_id = p_location_id and business_date = p_business_date;

  if not found then
    insert into public.business_days (tenant_id, location_id, business_date, status, closed_at, closing_reason)
    values (
      p_tenant_id, p_location_id, p_business_date, 'closed', now(),
      'Created automatically to post a completed order to Sales'
    )
    on conflict (tenant_id, location_id, business_date) do nothing;

    select * into v_day
    from public.business_days
    where tenant_id = p_tenant_id and location_id = p_location_id and business_date = p_business_date;
  end if;

  return v_day.id;
end;
$$;

revoke execute on function public._resolve_or_create_closed_business_day(uuid, uuid, date) from public, authenticated;

-- Posts every item of one completed order into `sales`, once. Internal
-- helper, only ever called from complete_order() below, in the SAME
-- transaction as the status transition -- an order can never end up
-- "completed but not posted" or vice versa.
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

  -- The location's OWN timezone, not UTC -- a hardcoded UTC truncation
  -- can land an order completed late at night on the wrong calendar
  -- date from the tenant's own perspective (e.g. 1am East Africa Time
  -- is still the previous day in UTC).
  v_business_date := (v_order.completed_at at time zone coalesce(v_location_timezone, 'UTC'))::date;
  v_business_day_id := public._resolve_or_create_closed_business_day(v_order.tenant_id, v_location_id, v_business_date);

  select id into v_others_product_id
  from public.products
  where tenant_id = v_order.tenant_id and is_system = true
  limit 1;

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
      -- order_product_id missing/unresolvable -- fall back to the
      -- tenant's "Others" system product, same fallback SalesService.
      -- recordSale already supports for a sale with no real catalog
      -- product, using the order item's own snapshot as the display name.
      if v_others_product_id is null then
        raise exception 'Cannot post order to Sales: tenant has no "Others" product to fall back to';
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

-- Redefines 0093's complete_order() -- never editing that migration
-- file itself -- adding the posting step right after the existing
-- status transition, inside the same transaction.
create or replace function public.complete_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_actor uuid := auth.uid();
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if not public.has_permission(v_order.tenant_id, 'orders.complete') then
    raise exception 'Not authorized to complete orders';
  end if;

  if v_order.status <> 'on_delivery' then
    raise exception 'Order is "%", not on delivery -- it cannot be completed from this state', v_order.status;
  end if;

  update public.orders
  set status = 'completed', completed_by = v_actor, completed_at = now()
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by)
  values (v_order.tenant_id, p_order_id, 'on_delivery', 'completed', v_actor);

  perform public._post_order_to_sales(p_order_id, v_actor);

  update public.orders set posted_to_sales = true where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;
