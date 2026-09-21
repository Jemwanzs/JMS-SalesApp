-- ============================================================================
-- 0093_order_status_transitions.sql
--
-- CUSTOMER ORDERS MODULE — PHASE 2c: STAFF ORDER MANAGEMENT.
--
-- `orders` was deliberately left with no UPDATE RLS policy at all in
-- migration 0092 -- the same invariant `sales` has always had ("no
-- UPDATE/DELETE policy, mutation only through SECURITY DEFINER
-- functions": void_sale/correct_sale/reverse_sale, migration 0006).
-- These four functions are that controlled path for Customer Orders'
-- own status workflow: received -> being_attended -> on_delivery ->
-- completed, plus a cancel escape hatch from any of the first three.
-- No approval-routing (unlike void_sale's optional approval step) --
-- nothing in the spec asks for a second sign-off on an order status
-- change.
-- ============================================================================

-- Automatic, view-triggered (spec section 17) -- NOT a button. The
-- Order Detail page calls this as a side effect of rendering a
-- 'received' order. `for update` + `where status = 'received'` makes
-- this safe if two staff open the same order at once: whichever
-- UPDATE actually lands wins; the other call's row lock waits, then
-- sees the already-updated status and simply returns it -- not an
-- error, since viewing an already-attended order is completely normal
-- (spec: "prevents another staff member from ASSUMING nobody has
-- started," not "prevents a second person from opening it").
create or replace function public.attend_order(p_order_id uuid)
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

  if not public.has_permission(v_order.tenant_id, 'orders.attend') then
    raise exception 'Not authorized to attend orders';
  end if;

  if v_order.status <> 'received' then
    return v_order;
  end if;

  update public.orders
  set status = 'being_attended', attended_by = v_actor, attended_at = now()
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by)
  values (v_order.tenant_id, p_order_id, 'received', 'being_attended', v_actor);

  return v_order;
end;
$$;

create or replace function public.mark_order_on_delivery(
  p_order_id uuid,
  p_delivery_person_name text,
  p_delivery_person_mobile text,
  p_delivery_notes text
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_actor uuid := auth.uid();
begin
  if p_delivery_person_name is null or length(trim(p_delivery_person_name)) = 0 then
    raise exception 'Delivery person name is required';
  end if;
  if p_delivery_person_mobile is null or length(trim(p_delivery_person_mobile)) = 0 then
    raise exception 'Delivery person mobile number is required';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if not public.has_permission(v_order.tenant_id, 'orders.mark_on_delivery') then
    raise exception 'Not authorized to mark orders as on delivery';
  end if;

  if v_order.status <> 'being_attended' then
    raise exception 'Order is "%", not being attended -- it cannot be marked on delivery from this state', v_order.status;
  end if;

  update public.orders
  set status = 'on_delivery',
      delivery_person_name = p_delivery_person_name,
      delivery_person_mobile = p_delivery_person_mobile,
      delivery_notes = p_delivery_notes,
      dispatched_at = now()
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by)
  values (v_order.tenant_id, p_order_id, 'being_attended', 'on_delivery', v_actor);

  return v_order;
end;
$$;

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

  return v_order;
end;
$$;

create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders;
  v_actor uuid := auth.uid();
  -- Captured BEFORE the update below -- cancel can be reached from
  -- three different prior states, unlike the other three functions'
  -- single fixed from_status, so this can't be a literal. Using
  -- v_order.status directly in the history insert AFTER the update
  -- would wrongly record 'cancelled' as its own from_status.
  v_previous_status public.order_status;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to cancel an order';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if not public.has_permission(v_order.tenant_id, 'orders.cancel') then
    raise exception 'Not authorized to cancel orders';
  end if;

  if v_order.status not in ('received', 'being_attended', 'on_delivery') then
    raise exception 'Order is "%", not active -- it cannot be cancelled from this state', v_order.status;
  end if;

  v_previous_status := v_order.status;

  update public.orders
  set status = 'cancelled', cancelled_by = v_actor, cancelled_at = now(), cancellation_reason = p_reason
  where id = p_order_id
  returning * into v_order;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, changed_by, notes)
  values (v_order.tenant_id, p_order_id, v_previous_status, 'cancelled', v_actor, p_reason);

  return v_order;
end;
$$;
