-- ============================================================================
-- 0092_orders_module_foundations.sql
--
-- CUSTOMER ORDERS MODULE — PHASE 2a: FOUNDATIONS.
--
-- A brand-new, optional module: a public storefront where a tenant's
-- customers place orders directly, which staff then manage through a
-- status workflow. Deliberately, completely separate from the existing
-- Sales/Stock/Inventory engines -- no schema or logic change to any of
-- them. An order is NOT a sale; nothing here writes to `sales`,
-- `stock_movements`, or touches inventory in any way.
--
-- This phase (2a) only lays the foundation: schema, tenant settings,
-- permissions, and the storage bucket for Order Products photos. The
-- public storefront, order submission, staff order-management actions,
-- and customer tracking page are later phases -- deliberately NOT
-- built here. Consequently `orders`/`order_items`/`order_status_
-- history` get NO insert/update RLS policy at all yet (same "no direct
-- mutation, only through a controlled path" shape `sales` has always
-- had) -- the actual insert/update paths (a public service-role Server
-- Action for submission, staff actions for status transitions) land in
-- those later phases.
--
-- No location/branch scoping anywhere here: unlike expenses/sales,
-- Customer Orders is framed as ONE public ordering page per TENANT
-- (spec: `/order/{tenant-slug}`), not per branch -- delivery location
-- is a free-text customer-entered address, not one of the tenant's own
-- `locations` rows. `order_number_sequences` is therefore keyed
-- `(tenant_id, year)` only, unlike expense_number_sequences' extra
-- location_id column.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------

create type public.order_status as enum (
  'received', 'being_attended', 'on_delivery', 'completed', 'cancelled', 'rejected'
);

-- The separate order-facing product catalogue (spec section 6) -- never
-- the same rows as `products` (Sales' own catalogue). One image per
-- product, stored directly on the row (not a side table like
-- `product_images`) since Order Products need only ever show a single
-- photo, matching tenants.logo_url's simpler one-image-per-row shape
-- rather than ProductService's many-images-per-product design.
create table public.order_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  description text,
  image_storage_path text,
  image_url text,
  minimum_order_amount numeric(12, 2) not null default 0 check (minimum_order_amount >= 0),
  status text not null default 'active' check (status in ('active', 'archived')),
  is_available boolean not null default true,
  display_order integer not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_order_products_tenant on public.order_products (tenant_id, display_order);

create trigger set_order_products_updated_at
before update on public.order_products
for each row execute function public.set_updated_at();

-- Lightweight customer identity (spec section 5) -- explicitly NOT a
-- real JMS user account (no profiles/auth row, no login). One row per
-- (tenant, mobile number); a returning customer's repeat order reuses
-- this same row rather than creating a duplicate (enforced by the
-- unique constraint below -- the future submit-order action does an
-- upsert against it, never a plain insert).
create table public.order_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  mobile_number text not null,
  default_delivery_location text,
  first_order_at timestamptz,
  last_order_at timestamptz,
  order_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant_id, mobile_number)
);

create index idx_order_customers_tenant on public.order_customers (tenant_id);

-- Internal counter for order numbering -- mirrors expense_number_
-- sequences (migration 0081) exactly, minus location_id (see header).
-- No RLS policies: touched only by the trigger below (security definer).
create table public.order_number_sequences (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  year integer not null,
  current_value bigint not null default 0,
  primary key (tenant_id, year)
);

alter table public.order_number_sequences enable row level security;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_number text,
  -- Opaque, unguessable public tracking link component -- genuinely new
  -- infrastructure, nothing like it exists elsewhere in this codebase
  -- (confirmed before writing this migration). Never looked up by a
  -- sequential id from the public tracking page, only by this token.
  tracking_token uuid not null default gen_random_uuid(),
  -- Same idempotency-key discipline as SalesService.recordSale --
  -- column added now so the future submit-order action needs no later
  -- ALTER; the unique constraint below is what actually enforces it.
  idempotency_key uuid not null,
  customer_id uuid references public.order_customers (id),
  customer_name_snapshot text not null,
  customer_mobile_snapshot text not null,
  delivery_location text not null,
  delivery_directions text,
  order_notes text,
  order_total numeric(12, 2) not null check (order_total >= 0),
  status public.order_status not null default 'received',
  attended_by uuid references public.profiles (id),
  attended_at timestamptz,
  delivery_person_name text,
  delivery_person_mobile text,
  delivery_notes text,
  dispatched_at timestamptz,
  completed_by uuid references public.profiles (id),
  completed_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_number),
  unique (tenant_id, idempotency_key),
  unique (tracking_token)
);

create index idx_orders_tenant_status on public.orders (tenant_id, status, created_at desc);
create index idx_orders_tenant_customer on public.orders (tenant_id, customer_id);

create trigger set_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- Snapshots (product name/image/minimum) so a historical order stays
-- accurate even after order_products is later edited -- same reasoning
-- `sales.product_name_snapshot` and `expenses`' item/category snapshots
-- already establish throughout this app.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  order_product_id uuid references public.order_products (id),
  product_name_snapshot text not null,
  product_image_snapshot text,
  minimum_order_snapshot numeric(12, 2),
  requested_amount numeric(12, 2) not null check (requested_amount >= 0),
  created_at timestamptz not null default now()
);

create index idx_order_items_order on public.order_items (order_id);
create index idx_order_items_tenant on public.order_items (tenant_id);

-- Append-only audit trail (spec section 31) -- never overwritten,
-- mirrors expense_corrections/sale_corrections' own "history table,
-- write-only from the controlled mutation path" shape. changed_by is
-- nullable: the very first 'received' row is written by the public,
-- unauthenticated order-submission path, which has no profiles.id to
-- attribute it to.
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now(),
  notes text
);

create index idx_order_status_history_order on public.order_status_history (order_id, changed_at);

-- ----------------------------------------------------------------------------
-- 2. Order numbering -- mirrors assign_expense_number() (migration 0081)
-- ----------------------------------------------------------------------------

create or replace function public.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year integer;
  v_seq bigint;
begin
  if new.order_number is not null then
    return new;
  end if;

  v_year := extract(year from new.created_at);

  insert into public.order_number_sequences (tenant_id, year, current_value)
  values (new.tenant_id, v_year, 1)
  on conflict (tenant_id, year)
  do update set current_value = public.order_number_sequences.current_value + 1
  returning current_value into v_seq;

  new.order_number := 'ORD-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  return new;
end;
$$;

create trigger set_order_number
before insert on public.orders
for each row execute function public.assign_order_number();

-- ----------------------------------------------------------------------------
-- 3. RLS
-- ----------------------------------------------------------------------------

alter table public.order_products enable row level security;
alter table public.order_customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

create policy order_products_select on public.order_products
for select to authenticated
using (public.has_permission(tenant_id, 'orders.view') or public.has_permission(tenant_id, 'orders.manage_products'));

create policy order_products_write on public.order_products
for all to authenticated
using (public.has_permission(tenant_id, 'orders.manage_products'))
with check (public.has_permission(tenant_id, 'orders.manage_products'));

create policy order_customers_select on public.order_customers
for select to authenticated
using (public.has_permission(tenant_id, 'orders.view_customers'));
-- No write policy -- order_customers is only ever written by the future
-- public submit-order Server Action, via the service-role client
-- (bypasses RLS entirely, same as every platform-admin action already
-- does), never by an authenticated tenant member directly.

-- view_all OR view together (both simply mean "can read" for now --
-- Phase 2a has no per-staff assignment/branch boundary to enforce yet;
-- see this migration's own header + the plan's note on why sales'
-- exact view_own/view_all split doesn't transfer cleanly here, since a
-- brand new order's attended_by is null until someone opens it, so a
-- literal `attended_by = auth.uid()` clause would hide every new order
-- from a plain 'orders.view' holder -- the wrong behavior). A future
-- phase can narrow 'orders.view' with a real WHERE clause without
-- breaking this OR's 'orders.view_all' escape hatch.
create policy orders_select on public.orders
for select to authenticated
using (public.has_permission(tenant_id, 'orders.view_all') or public.has_permission(tenant_id, 'orders.view'));

create policy order_items_select on public.order_items
for select to authenticated
using (public.has_permission(tenant_id, 'orders.view_all') or public.has_permission(tenant_id, 'orders.view'));

create policy order_status_history_select on public.order_status_history
for select to authenticated
using (public.has_permission(tenant_id, 'orders.view_all') or public.has_permission(tenant_id, 'orders.view'));

-- Deliberately no insert/update policy on orders/order_items/order_
-- status_history -- see this migration's own header comment.

-- ----------------------------------------------------------------------------
-- 4. Storage bucket for Order Products photos -- mirrors product-images
--    (migrations 0007 + 0041) exactly, combined into one statement
--    since this bucket is created fresh rather than hardened later.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('order-product-images', 'order-product-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy order_product_images_storage_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'order-product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'orders.manage_products')
);

create policy order_product_images_storage_update on storage.objects
for update to authenticated
using (
  bucket_id = 'order-product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'orders.manage_products')
)
with check (
  bucket_id = 'order-product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'orders.manage_products')
);

create policy order_product_images_storage_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'order-product-images'
  and public.has_permission(((storage.foldername(name))[1])::uuid, 'orders.manage_products')
);

-- ----------------------------------------------------------------------------
-- 5. Permissions -- new 'orders' module, Tenant-Administrator-only by
--    default (SQL backfill only, nothing added to RoleService.ts's
--    DEFAULT_ROLE_GRANTS), matching this session's own established
--    convention for new/niche permissions. All ten created now even
--    though several aren't exercised until later phases -- one
--    migration for the whole module's permission catalog, not one per
--    phase.
-- ----------------------------------------------------------------------------

insert into public.permissions (key, module, description, is_read_only) values
  ('orders.view', 'orders', 'View orders', true),
  ('orders.view_all', 'orders', 'View every order, not just ones you are attending', true),
  ('orders.attend', 'orders', 'Open and attend to a new order', false),
  ('orders.mark_on_delivery', 'orders', 'Mark an order as on delivery', false),
  ('orders.complete', 'orders', 'Mark an order as completed', false),
  ('orders.cancel', 'orders', 'Cancel or reject an order', false),
  ('orders.view_customers', 'orders', 'View the customer order database', true),
  ('orders.manage_products', 'orders', 'Configure the Order Products catalogue', false),
  ('orders.manage_settings', 'orders', 'Configure Customer Orders settings', false),
  ('orders.view_analytics', 'orders', 'View order analytics', true);

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.is_system_default and r.name = 'Tenant Administrator'
  and p.module = 'orders'
on conflict do nothing;
