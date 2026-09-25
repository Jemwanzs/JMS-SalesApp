-- ============================================================================
-- 0098_order_processed_by_branch_employee.sql
--
-- ORDER PROCESSING -- EMPLOYEE & BRANCH ATTRIBUTION.
--
-- Completing an order (received -> ... -> completed, complete_order())
-- now requires the actor to confirm WHICH employee processed the order
-- and WHICH branch it was processed from, in addition to the existing
-- completed_by (the authenticated actor performing the click) /
-- completed_at pair -- these are deliberately separate concepts: a
-- supervisor can complete an order and credit a different employee
-- (e.g. the one who actually delivered it), same as the existing
-- Delivery Person Name/Mobile fields already capture a person who
-- isn't necessarily a JMS user at all. processed_by_employee_id IS
-- always a real tenant member though (unlike delivery_person_name),
-- since it feeds employee performance reporting.
--
-- Branch scoping reuses the EXISTING Multi-Branch User Access model
-- (user_role_assignments.location_id -- null means tenant-wide, same
-- convention UserService.listUsers/resolveUserBranches already read)
-- rather than inventing a new permission: the actor can only select a
-- branch they themselves are assigned to (or any branch, if their own
-- assignment is tenant-wide), and can only credit an employee who is
-- themselves assigned to the chosen branch. Selecting a DIFFERENT
-- employee than yourself is gated on a new permission
-- (orders.reassign_processed_by, Tenant-Administrator-only by
-- default, matching this session's established "new capability = new
-- permission key" convention) -- picking your own branch/name needs
-- no special permission beyond the existing orders.complete.
--
-- Confirmed with the user: the branch selected here REPLACES
-- migrations 0096/0097's "auto-pick the tenant's oldest-created
-- location" placeholder for where the resulting Sale posts -- that
-- guess existed only because no real branch was known at completion
-- time; now one is always confirmed, so _post_order_to_sales takes it
-- as a parameter instead of resolving it itself.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema
-- ----------------------------------------------------------------------------

alter table public.orders
  add column processed_by_employee_id uuid references public.profiles (id),
  add column processed_from_location_id uuid references public.locations (id);

create index idx_orders_processed_from_location on public.orders (tenant_id, processed_from_location_id);
create index idx_orders_processed_by_employee on public.orders (tenant_id, processed_by_employee_id);

-- ----------------------------------------------------------------------------
-- 2. Permission
-- ----------------------------------------------------------------------------

insert into public.permissions (key, module, description, is_read_only) values
  ('orders.reassign_processed_by', 'orders', 'Record a different employee than yourself as having processed an order', false);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.key = 'orders.reassign_processed_by'
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 3. _post_order_to_sales -- now takes the confirmed branch as a
--    parameter instead of resolving "primary location" itself. Old
--    2-arg signature dropped (this migration's caller, complete_order,
--    is being redefined in the same migration, so nothing else can
--    still be depending on the old shape).
-- ----------------------------------------------------------------------------

drop function if exists public._post_order_to_sales(uuid, uuid);

create or replace function public._post_order_to_sales(p_order_id uuid, p_actor uuid, p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
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

  select timezone into v_location_timezone
  from public.locations
  where id = p_location_id and tenant_id = v_order.tenant_id;

  v_business_date := (v_order.completed_at at time zone coalesce(v_location_timezone, 'UTC'))::date;
  v_business_day_id := public._resolve_or_create_closed_business_day(v_order.tenant_id, p_location_id, v_business_date);

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
      v_order.tenant_id, p_location_id, v_business_day_id, v_use_product_id,
      v_name_snapshot, v_image_snapshot, v_price_snapshot,
      v_item.requested_amount, null, 'Posted from Order #' || coalesce(v_order.order_number, p_order_id::text), p_actor, v_business_date,
      gen_random_uuid(), v_item.id
    )
    on conflict (source_order_item_id) where source_order_item_id is not null do nothing;
  end loop;
end;
$$;

revoke execute on function public._post_order_to_sales(uuid, uuid, uuid) from public, authenticated;

-- ----------------------------------------------------------------------------
-- 4. complete_order -- now requires + validates an employee and a
--    branch. Old 1-arg signature dropped; the client call site is
--    updated in the same change (OrderService.completeOrder).
-- ----------------------------------------------------------------------------

drop function if exists public.complete_order(uuid);

create or replace function public.complete_order(p_order_id uuid, p_employee_id uuid, p_location_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_actor uuid := auth.uid();
  v_actor_membership_id uuid;
  v_employee_membership_id uuid;
  v_location_ok boolean;
  v_actor_branch_ok boolean;
  v_employee_branch_ok boolean;
begin
  if p_employee_id is null then
    raise exception 'An employee must be selected';
  end if;
  if p_location_id is null then
    raise exception 'A branch must be selected';
  end if;

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

  select exists (
    select 1 from public.locations
    where id = p_location_id and tenant_id = v_order.tenant_id and status = 'active'
  ) into v_location_ok;
  if not v_location_ok then
    raise exception 'Selected branch is not valid for this tenant';
  end if;

  select id into v_actor_membership_id
  from public.tenant_memberships
  where tenant_id = v_order.tenant_id and profile_id = v_actor and status = 'active';
  if v_actor_membership_id is null then
    raise exception 'Not an active member of this tenant';
  end if;

  select exists (
    select 1 from public.user_role_assignments
    where tenant_membership_id = v_actor_membership_id
      and (location_id is null or location_id = p_location_id)
  ) into v_actor_branch_ok;
  if not v_actor_branch_ok then
    raise exception 'You are not assigned to the selected branch';
  end if;

  if p_employee_id <> v_actor and not public.has_permission(v_order.tenant_id, 'orders.reassign_processed_by') then
    raise exception 'Not authorized to record a different employee for this order';
  end if;

  select id into v_employee_membership_id
  from public.tenant_memberships
  where tenant_id = v_order.tenant_id and profile_id = p_employee_id and status = 'active';
  if v_employee_membership_id is null then
    raise exception 'Selected employee is not an active member of this tenant';
  end if;

  select exists (
    select 1 from public.user_role_assignments
    where tenant_membership_id = v_employee_membership_id
      and (location_id is null or location_id = p_location_id)
  ) into v_employee_branch_ok;
  if not v_employee_branch_ok then
    raise exception 'Selected employee is not assigned to the selected branch';
  end if;

  update public.orders
  set status = 'completed',
      completed_by = v_actor,
      completed_at = now(),
      processed_by_employee_id = p_employee_id,
      processed_from_location_id = p_location_id
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by)
  values (v_order.tenant_id, p_order_id, 'on_delivery', 'completed', v_actor);

  perform public._post_order_to_sales(p_order_id, v_actor, p_location_id);
  update public.orders set posted_to_sales = true where id = p_order_id returning * into v_order;

  return v_order;
end;
$$;
